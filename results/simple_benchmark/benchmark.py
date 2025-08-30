"""
Storage Service Performance Benchmark Tool
==========================================
A comprehensive benchmarking tool for comparing optimized vs unoptimized
storage service performance with scientific data analysis and visualization.
"""

import logging
import time
import warnings
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple, Optional

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import requests
import seaborn as sns
from scipy import stats

warnings.filterwarnings('ignore')

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('benchmark.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Set style for scientific plots
plt.style.use('seaborn-v0_8-darkgrid')
sns.set_palette("husl")


@dataclass
class BenchmarkConfig:
    """Configuration for benchmark testing"""
    base_url: str = "http://localhost:8000"
    num_requests: int = 100
    concurrent_requests: int = 10
    warmup_requests: int = 5
    timeout: int = 30
    output_dir: Path = field(default_factory=lambda: Path("benchmark_results"))

    def __post_init__(self):
        self.output_dir.mkdir(parents=True, exist_ok=True)


@dataclass
class RequestMetrics:
    """Metrics for a single request"""
    object_id: str
    mode: str  # 'optimized' or 'unoptimized'
    ttfb: float  # Time to first byte in ms
    total_latency: float  # Total request time in ms
    server_latency: float  # Server-reported latency in ms
    download_size: int  # Size in bytes
    cache_hit: bool
    download_source: str
    timestamp: datetime
    request_number: int
    thread_id: int

    def to_dict(self) -> Dict:
        """Convert to dictionary for DataFrame"""
        data = asdict(self)
        data['timestamp'] = self.timestamp.isoformat()
        return data


class StorageServiceClient:
    """Client for interacting with the storage service"""

    def __init__(self, config: BenchmarkConfig):
        self.config = config
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Storage-Benchmark/1.0'
        })

    def preload_all_cache(self) -> bool:
        """Preload all objects into cache"""
        logger.info("Starting cache preload...")
        try:
            response = self.session.post(
                f"{self.config.base_url}/cache/preload-all",
                timeout=120
            )
            response.raise_for_status()
            result = response.json()
            logger.info(f"Cache preload completed: {result}")
            return result.get('status') == 'success'
        except Exception as e:
            logger.error(f"Cache preload failed: {e}")
            return False

    def get_all_object_ids(self) -> List[str]:
        """Retrieve all object IDs from the service"""
        logger.info("Fetching all object IDs...")
        try:
            response = self.session.get(
                f"{self.config.base_url}/api/storage/objects",
                timeout=self.config.timeout
            )
            response.raise_for_status()
            objects = response.json()
            ids = [obj['ID'] for obj in objects]
            logger.info(f"Found {len(ids)} objects")
            return ids
        except Exception as e:
            logger.error(f"Failed to fetch object IDs: {e}")
            return []

    def download_object(self, object_id: str, mode: str, request_num: int,
                        thread_id: int) -> Optional[RequestMetrics]:
        """Download a single object and measure performance"""
        headers = {}
        if mode == 'optimized':
            headers['X-Optimization-Mode'] = 'optimized'

        url = f"{self.config.base_url}/api/storage/objects/{object_id}/download"

        try:
            # Measure TTFB
            start_time = time.perf_counter()
            response = self.session.get(
                url,
                headers=headers,
                stream=True,
                timeout=self.config.timeout
            )

            # Time to first byte
            ttfb = (time.perf_counter() - start_time) * 1000

            # Download complete content
            content = b''
            for chunk in response.iter_content(chunk_size=8192):
                content += chunk

            # Total latency
            total_latency = (time.perf_counter() - start_time) * 1000

            # Extract metrics from headers
            server_latency = float(response.headers.get('X-Latency-Ms', 0))
            cache_hit = response.headers.get('X-Cache-Hit', 'false').lower() == 'true'
            download_source = response.headers.get('X-Download-Source', 'unknown')
            content_size = len(content)

            return RequestMetrics(
                object_id=object_id,
                mode=mode,
                ttfb=ttfb,
                total_latency=total_latency,
                server_latency=server_latency,
                download_size=content_size,
                cache_hit=cache_hit,
                download_source=download_source,
                timestamp=datetime.now(),
                request_number=request_num,
                thread_id=thread_id
            )

        except Exception as e:
            logger.error(f"Request failed for {object_id} in {mode} mode: {e}")
            return None


class BenchmarkRunner:
    """Main benchmark execution and analysis"""

    def __init__(self, config: BenchmarkConfig):
        self.config = config
        self.client = StorageServiceClient(config)
        self.results: List[RequestMetrics] = []
        self.timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    def run_benchmark_for_mode(self, object_ids: List[str], mode: str) -> List[RequestMetrics]:
        """Run benchmark for a specific mode"""
        logger.info(f"Starting benchmark for {mode} mode")
        metrics = []

        # Create request queue (repeat IDs to reach num_requests)
        request_queue = []
        for i in range(self.config.num_requests):
            object_id = object_ids[i % len(object_ids)]
            request_queue.append((object_id, i))

        # Warmup phase
        logger.info(f"Running {self.config.warmup_requests} warmup requests...")
        for i in range(self.config.warmup_requests):
            object_id = object_ids[i % len(object_ids)]
            self.client.download_object(object_id, mode, -1, -1)

        # Main benchmark phase
        logger.info(f"Running {self.config.num_requests} benchmark requests...")
        with ThreadPoolExecutor(max_workers=self.config.concurrent_requests) as executor:
            futures = []
            for object_id, request_num in request_queue:
                future = executor.submit(
                    self.client.download_object,
                    object_id, mode, request_num,
                    hash(executor) % 1000  # Simple thread ID
                )
                futures.append(future)

            # Collect results with progress
            for i, future in enumerate(as_completed(futures)):
                result = future.result()
                if result:
                    metrics.append(result)
                if (i + 1) % 10 == 0:
                    logger.info(f"Progress: {i + 1}/{self.config.num_requests} requests completed")

        logger.info(f"Completed {len(metrics)} successful requests for {mode} mode")
        return metrics

    def run_full_benchmark(self) -> Tuple[pd.DataFrame, pd.DataFrame]:
        """Run complete benchmark for both modes"""
        # Preload cache
        if not self.client.preload_all_cache():
            logger.warning("Cache preload failed, continuing anyway...")
            time.sleep(2)  # Give cache time to stabilize

        # Get object IDs
        object_ids = self.client.get_all_object_ids()
        if not object_ids:
            raise ValueError("No objects found in storage service")

        # Run benchmarks
        optimized_metrics = self.run_benchmark_for_mode(object_ids, 'optimized')

        # Clear cache between tests for fair comparison
        logger.info("Waiting 5 seconds before unoptimized test...")
        time.sleep(5)

        unoptimized_metrics = self.run_benchmark_for_mode(object_ids, 'unoptimized')

        # Convert to DataFrames
        df_optimized = pd.DataFrame([m.to_dict() for m in optimized_metrics])
        df_unoptimized = pd.DataFrame([m.to_dict() for m in unoptimized_metrics])

        return df_optimized, df_unoptimized

    def save_raw_data(self, df_optimized: pd.DataFrame, df_unoptimized: pd.DataFrame):
        """Save raw benchmark data"""
        output_file = self.config.output_dir / f"benchmark_raw_{self.timestamp}.csv"

        # Combine dataframes
        df_combined = pd.concat([df_optimized, df_unoptimized], ignore_index=True)
        df_combined.to_csv(output_file, index=False)
        logger.info(f"Raw data saved to {output_file}")

        # Also save as Excel with separate sheets
        excel_file = self.config.output_dir / f"benchmark_results_{self.timestamp}.xlsx"
        with pd.ExcelWriter(excel_file, engine='openpyxl') as writer:
            df_optimized.to_excel(writer, sheet_name='Optimized', index=False)
            df_unoptimized.to_excel(writer, sheet_name='Unoptimized', index=False)

            # Add summary statistics sheet
            summary = self.calculate_statistics(df_optimized, df_unoptimized)
            summary.to_excel(writer, sheet_name='Summary')

        logger.info(f"Excel report saved to {excel_file}")

    def calculate_statistics(self, df_opt: pd.DataFrame, df_unopt: pd.DataFrame) -> pd.DataFrame:
        """Calculate comprehensive statistics"""
        stats_data = []

        for df, mode in [(df_opt, 'optimized'), (df_unopt, 'unoptimized')]:
            stats_data.append({
                'Mode': mode,
                'Mean TTFB (ms)': df['ttfb'].mean(),
                'Median TTFB (ms)': df['ttfb'].median(),
                'Std TTFB (ms)': df['ttfb'].std(),
                'P95 TTFB (ms)': df['ttfb'].quantile(0.95),
                'P99 TTFB (ms)': df['ttfb'].quantile(0.99),
                'Mean Total Latency (ms)': df['total_latency'].mean(),
                'Median Total Latency (ms)': df['total_latency'].median(),
                'Std Total Latency (ms)': df['total_latency'].std(),
                'P95 Total Latency (ms)': df['total_latency'].quantile(0.95),
                'P99 Total Latency (ms)': df['total_latency'].quantile(0.99),
                'Mean Server Latency (ms)': df['server_latency'].mean(),
                'Cache Hit Rate (%)': (df['cache_hit'].sum() / len(df)) * 100 if 'cache_hit' in df else 0,
                'Total Requests': len(df),
                'Failed Requests': self.config.num_requests - len(df),
                'Success Rate (%)': (len(df) / self.config.num_requests) * 100
            })

        summary_df = pd.DataFrame(stats_data)

        # Calculate improvement
        if len(stats_data) == 2:
            improvement = {
                'Mode': 'Improvement',
                'Mean TTFB (ms)': f"{((stats_data[1]['Mean TTFB (ms)'] - stats_data[0]['Mean TTFB (ms)']) / stats_data[1]['Mean TTFB (ms)'] * 100):.1f}%",
                'Median TTFB (ms)': f"{((stats_data[1]['Median TTFB (ms)'] - stats_data[0]['Median TTFB (ms)']) / stats_data[1]['Median TTFB (ms)'] * 100):.1f}%",
                'Mean Total Latency (ms)': f"{((stats_data[1]['Mean Total Latency (ms)'] - stats_data[0]['Mean Total Latency (ms)']) / stats_data[1]['Mean Total Latency (ms)'] * 100):.1f}%",
            }
            summary_df = pd.concat([summary_df, pd.DataFrame([improvement])], ignore_index=True)

        return summary_df

    def perform_statistical_tests(self, df_opt: pd.DataFrame, df_unopt: pd.DataFrame) -> Dict:
        """Perform statistical significance tests"""
        results = {}

        # T-test for TTFB
        t_stat_ttfb, p_value_ttfb = stats.ttest_ind(df_opt['ttfb'], df_unopt['ttfb'])
        results['ttfb_t_test'] = {
            't_statistic': t_stat_ttfb,
            'p_value': p_value_ttfb,
            'significant': p_value_ttfb < 0.05
        }

        # T-test for total latency
        t_stat_total, p_value_total = stats.ttest_ind(df_opt['total_latency'], df_unopt['total_latency'])
        results['total_latency_t_test'] = {
            't_statistic': t_stat_total,
            'p_value': p_value_total,
            'significant': p_value_total < 0.05
        }

        # Mann-Whitney U test (non-parametric alternative)
        u_stat_ttfb, p_value_u_ttfb = stats.mannwhitneyu(df_opt['ttfb'], df_unopt['ttfb'])
        results['ttfb_mann_whitney'] = {
            'u_statistic': u_stat_ttfb,
            'p_value': p_value_u_ttfb,
            'significant': p_value_u_ttfb < 0.05
        }

        # Effect size (Cohen's d)
        cohens_d_ttfb = (df_unopt['ttfb'].mean() - df_opt['ttfb'].mean()) / np.sqrt(
            (df_opt['ttfb'].std() ** 2 + df_unopt['ttfb'].std() ** 2) / 2)
        results['ttfb_effect_size'] = {
            'cohens_d': cohens_d_ttfb,
            'interpretation': self._interpret_cohens_d(cohens_d_ttfb)
        }

        return results

    def _interpret_cohens_d(self, d: float) -> str:
        """Interpret Cohen's d effect size"""
        d = abs(d)
        if d < 0.2:
            return "negligible"
        elif d < 0.5:
            return "small"
        elif d < 0.8:
            return "medium"
        else:
            return "large"

    def create_visualizations(self, df_opt: pd.DataFrame, df_unopt: pd.DataFrame):
        """Create comprehensive scientific visualizations"""
        # Create figure with subplots
        fig = plt.figure(figsize=(20, 16))

        # 1. TTFB Comparison Box Plot
        ax1 = plt.subplot(3, 3, 1)
        data_ttfb = [df_opt['ttfb'], df_unopt['ttfb']]
        bp1 = ax1.boxplot(data_ttfb, labels=['Optimized', 'Unoptimized'], showfliers=True)
        ax1.set_ylabel('TTFB (ms)')
        ax1.set_title('Time to First Byte Comparison')
        ax1.grid(True, alpha=0.3)

        # Add mean markers
        ax1.scatter([1, 2], [df_opt['ttfb'].mean(), df_unopt['ttfb'].mean()],
                    color='red', marker='D', s=100, zorder=5, label='Mean')
        ax1.legend()

        # 2. Total Latency Comparison Box Plot
        ax2 = plt.subplot(3, 3, 2)
        data_total = [df_opt['total_latency'], df_unopt['total_latency']]
        bp2 = ax2.boxplot(data_total, labels=['Optimized', 'Unoptimized'], showfliers=True)
        ax2.set_ylabel('Total Latency (ms)')
        ax2.set_title('Total Latency Comparison')
        ax2.grid(True, alpha=0.3)

        # 3. TTFB Distribution (Histogram)
        ax3 = plt.subplot(3, 3, 3)
        ax3.hist(df_opt['ttfb'], bins=30, alpha=0.5, label='Optimized', color='blue', density=True)
        ax3.hist(df_unopt['ttfb'], bins=30, alpha=0.5, label='Unoptimized', color='red', density=True)
        ax3.set_xlabel('TTFB (ms)')
        ax3.set_ylabel('Density')
        ax3.set_title('TTFB Distribution')
        ax3.legend()
        ax3.grid(True, alpha=0.3)

        # 4. CDF Comparison
        ax4 = plt.subplot(3, 3, 4)
        sorted_opt = np.sort(df_opt['ttfb'])
        sorted_unopt = np.sort(df_unopt['ttfb'])
        p_opt = np.arange(1, len(sorted_opt) + 1) / len(sorted_opt)
        p_unopt = np.arange(1, len(sorted_unopt) + 1) / len(sorted_unopt)
        ax4.plot(sorted_opt, p_opt, label='Optimized', linewidth=2)
        ax4.plot(sorted_unopt, p_unopt, label='Unoptimized', linewidth=2)
        ax4.set_xlabel('TTFB (ms)')
        ax4.set_ylabel('Cumulative Probability')
        ax4.set_title('Cumulative Distribution Function')
        ax4.legend()
        ax4.grid(True, alpha=0.3)

        # 5. Time Series of Latencies
        ax5 = plt.subplot(3, 3, 5)
        ax5.plot(df_opt['request_number'], df_opt['ttfb'], alpha=0.6, label='Optimized', marker='o', markersize=2)
        ax5.plot(df_unopt['request_number'], df_unopt['ttfb'], alpha=0.6, label='Unoptimized', marker='s', markersize=2)
        ax5.set_xlabel('Request Number')
        ax5.set_ylabel('TTFB (ms)')
        ax5.set_title('TTFB Over Time')
        ax5.legend()
        ax5.grid(True, alpha=0.3)

        # 6. Server vs Total Latency Scatter
        ax6 = plt.subplot(3, 3, 6)
        ax6.scatter(df_opt['server_latency'], df_opt['total_latency'], alpha=0.5, label='Optimized', s=20)
        ax6.scatter(df_unopt['server_latency'], df_unopt['total_latency'], alpha=0.5, label='Unoptimized', s=20)
        ax6.set_xlabel('Server Latency (ms)')
        ax6.set_ylabel('Total Latency (ms)')
        ax6.set_title('Server vs Total Latency Correlation')
        ax6.legend()
        ax6.grid(True, alpha=0.3)

        # Add diagonal reference line
        max_val = max(ax6.get_xlim()[1], ax6.get_ylim()[1])
        ax6.plot([0, max_val], [0, max_val], 'k--', alpha=0.3, linewidth=1)

        # 7. Percentile Comparison
        ax7 = plt.subplot(3, 3, 7)
        percentiles = [50, 75, 90, 95, 99]
        opt_percentiles = [df_opt['ttfb'].quantile(p / 100) for p in percentiles]
        unopt_percentiles = [df_unopt['ttfb'].quantile(p / 100) for p in percentiles]

        x = np.arange(len(percentiles))
        width = 0.35
        ax7.bar(x - width / 2, opt_percentiles, width, label='Optimized')
        ax7.bar(x + width / 2, unopt_percentiles, width, label='Unoptimized')
        ax7.set_xlabel('Percentile')
        ax7.set_ylabel('TTFB (ms)')
        ax7.set_title('TTFB Percentiles')
        ax7.set_xticks(x)
        ax7.set_xticklabels([f'P{p}' for p in percentiles])
        ax7.legend()
        ax7.grid(True, alpha=0.3)

        # 8. Cache Hit Rate (if applicable)
        ax8 = plt.subplot(3, 3, 8)
        if 'cache_hit' in df_opt.columns:
            cache_data = pd.DataFrame({
                'Optimized': [df_opt['cache_hit'].sum(), len(df_opt) - df_opt['cache_hit'].sum()],
                'Unoptimized': [df_unopt['cache_hit'].sum(), len(df_unopt) - df_unopt['cache_hit'].sum()]
            }, index=['Cache Hit', 'Cache Miss'])
            cache_data.T.plot(kind='bar', stacked=True, ax=ax8)
            ax8.set_ylabel('Number of Requests')
            ax8.set_title('Cache Hit/Miss Distribution')
            ax8.set_xticklabels(['Optimized', 'Unoptimized'], rotation=0)
            ax8.legend(title='Result')
        else:
            ax8.text(0.5, 0.5, 'No cache data available', ha='center', va='center')
            ax8.set_title('Cache Statistics')

        # 9. Statistical Summary Text
        ax9 = plt.subplot(3, 3, 9)
        ax9.axis('off')

        stats_text = f"""Statistical Summary:

Optimized Mode:
  Mean TTFB: {df_opt['ttfb'].mean():.2f} ms
  Median TTFB: {df_opt['ttfb'].median():.2f} ms
  Std Dev: {df_opt['ttfb'].std():.2f} ms

Unoptimized Mode:
  Mean TTFB: {df_unopt['ttfb'].mean():.2f} ms
  Median TTFB: {df_unopt['ttfb'].median():.2f} ms
  Std Dev: {df_unopt['ttfb'].std():.2f} ms

Improvement:
  Mean: {((df_unopt['ttfb'].mean() - df_opt['ttfb'].mean()) / df_unopt['ttfb'].mean() * 100):.1f}%
  Median: {((df_unopt['ttfb'].median() - df_opt['ttfb'].median()) / df_unopt['ttfb'].median() * 100):.1f}%
        """
        ax9.text(0.1, 0.9, stats_text, transform=ax9.transAxes, fontsize=10,
                 verticalalignment='top', fontfamily='monospace')

        plt.suptitle(f'Storage Service Performance Benchmark - {self.timestamp}', fontsize=16, y=1.02)
        plt.tight_layout()

        # Save figure
        output_file = self.config.output_dir / f"benchmark_analysis_{self.timestamp}.png"
        plt.savefig(output_file, dpi=300, bbox_inches='tight')
        logger.info(f"Visualization saved to {output_file}")

        # Create additional detailed plots
        self.create_detailed_plots(df_opt, df_unopt)

    def create_detailed_plots(self, df_opt: pd.DataFrame, df_unopt: pd.DataFrame):
        """Create additional detailed scientific plots"""
        # Violin plot for better distribution visualization
        fig, axes = plt.subplots(1, 2, figsize=(14, 6))

        # TTFB Violin Plot
        data_ttfb = pd.DataFrame({
            'TTFB': pd.concat([df_opt['ttfb'], df_unopt['ttfb']]),
            'Mode': ['Optimized'] * len(df_opt) + ['Unoptimized'] * len(df_unopt)
        })
        sns.violinplot(data=data_ttfb, x='Mode', y='TTFB', ax=axes[0])
        axes[0].set_title('TTFB Distribution (Violin Plot)')
        axes[0].set_ylabel('TTFB (ms)')

        # Total Latency Violin Plot
        data_total = pd.DataFrame({
            'Total Latency': pd.concat([df_opt['total_latency'], df_unopt['total_latency']]),
            'Mode': ['Optimized'] * len(df_opt) + ['Unoptimized'] * len(df_unopt)
        })
        sns.violinplot(data=data_total, x='Mode', y='Total Latency', ax=axes[1])
        axes[1].set_title('Total Latency Distribution (Violin Plot)')
        axes[1].set_ylabel('Total Latency (ms)')

        plt.suptitle('Detailed Distribution Analysis')
        plt.tight_layout()

        output_file = self.config.output_dir / f"benchmark_violin_{self.timestamp}.png"
        plt.savefig(output_file, dpi=300, bbox_inches='tight')

        # Q-Q plots for normality assessment
        fig, axes = plt.subplots(2, 2, figsize=(12, 10))

        # Q-Q plot for optimized TTFB
        stats.probplot(df_opt['ttfb'], dist="norm", plot=axes[0, 0])
        axes[0, 0].set_title('Q-Q Plot: Optimized TTFB')

        # Q-Q plot for unoptimized TTFB
        stats.probplot(df_unopt['ttfb'], dist="norm", plot=axes[0, 1])
        axes[0, 1].set_title('Q-Q Plot: Unoptimized TTFB')

        # Q-Q plot for optimized total latency
        stats.probplot(df_opt['total_latency'], dist="norm", plot=axes[1, 0])
        axes[1, 0].set_title('Q-Q Plot: Optimized Total Latency')

        # Q-Q plot for unoptimized total latency
        stats.probplot(df_unopt['total_latency'], dist="norm", plot=axes[1, 1])
        axes[1, 1].set_title('Q-Q Plot: Unoptimized Total Latency')

        plt.suptitle('Normality Assessment (Q-Q Plots)')
        plt.tight_layout()

        output_file = self.config.output_dir / f"benchmark_qq_{self.timestamp}.png"
        plt.savefig(output_file, dpi=300, bbox_inches='tight')

        plt.close('all')

    def generate_report(self, df_opt: pd.DataFrame, df_unopt: pd.DataFrame,
                        stats_results: Dict):
        """Generate a comprehensive text report"""
        report_file = self.config.output_dir / f"benchmark_report_{self.timestamp}.txt"

        with open(report_file, 'w') as f:
            f.write("=" * 80 + "\n")
            f.write("STORAGE SERVICE PERFORMANCE BENCHMARK REPORT\n")
            f.write("=" * 80 + "\n\n")

            f.write(f"Timestamp: {self.timestamp}\n")
            f.write(f"Configuration:\n")
            f.write(f"  - Base URL: {self.config.base_url}\n")
            f.write(f"  - Total Requests per Mode: {self.config.num_requests}\n")
            f.write(f"  - Concurrent Requests: {self.config.concurrent_requests}\n")
            f.write(f"  - Warmup Requests: {self.config.warmup_requests}\n\n")

            f.write("-" * 80 + "\n")
            f.write("SUMMARY STATISTICS\n")
            f.write("-" * 80 + "\n\n")

            # Performance metrics
            summary_stats = self.calculate_statistics(df_opt, df_unopt)
            f.write(summary_stats.to_string())
            f.write("\n\n")

            f.write("-" * 80 + "\n")
            f.write("STATISTICAL SIGNIFICANCE TESTS\n")
            f.write("-" * 80 + "\n\n")

            # Statistical tests
            f.write("T-Test for TTFB:\n")
            f.write(f"  t-statistic: {stats_results['ttfb_t_test']['t_statistic']:.4f}\n")
            f.write(f"  p-value: {stats_results['ttfb_t_test']['p_value']:.6f}\n")
            f.write(f"  Significant (p < 0.05): {stats_results['ttfb_t_test']['significant']}\n\n")

            f.write("Mann-Whitney U Test for TTFB:\n")
            f.write(f"  U-statistic: {stats_results['ttfb_mann_whitney']['u_statistic']:.4f}\n")
            f.write(f"  p-value: {stats_results['ttfb_mann_whitney']['p_value']:.6f}\n")
            f.write(f"  Significant (p < 0.05): {stats_results['ttfb_mann_whitney']['significant']}\n\n")

            f.write("Effect Size (Cohen's d) for TTFB:\n")
            f.write(f"  Cohen's d: {stats_results['ttfb_effect_size']['cohens_d']:.4f}\n")
            f.write(f"  Interpretation: {stats_results['ttfb_effect_size']['interpretation']}\n\n")

            f.write("-" * 80 + "\n")
            f.write("CONCLUSION\n")
            f.write("-" * 80 + "\n\n")

            # Generate conclusion
            ttfb_improvement = ((df_unopt['ttfb'].mean() - df_opt['ttfb'].mean()) / df_unopt['ttfb'].mean() * 100)
            total_improvement = ((df_unopt['total_latency'].mean() - df_opt['total_latency'].mean()) / df_unopt[
                'total_latency'].mean() * 100)

            f.write(f"The optimized mode shows a {ttfb_improvement:.1f}% improvement in mean TTFB\n")
            f.write(f"and a {total_improvement:.1f}% improvement in mean total latency.\n\n")

            if stats_results['ttfb_t_test']['significant']:
                f.write("The performance improvement is statistically significant (p < 0.05).\n")
            else:
                f.write("The performance improvement is not statistically significant (p >= 0.05).\n")

            f.write(f"\nThe effect size is {stats_results['ttfb_effect_size']['interpretation']}, ")
            f.write(f"with Cohen's d = {stats_results['ttfb_effect_size']['cohens_d']:.4f}.\n")

        logger.info(f"Report saved to {report_file}")


def main():
    """Main execution function"""
    # Configuration
    config = BenchmarkConfig(
        base_url="http://localhost:8000",
        num_requests=100,  # Number of requests per mode
        concurrent_requests=10,  # Concurrent connections
        warmup_requests=5,  # Warmup requests
        timeout=30
    )

    # Create benchmark runner
    runner = BenchmarkRunner(config)

    try:
        # Run benchmark
        logger.info("Starting storage service benchmark...")
        df_optimized, df_unoptimized = runner.run_full_benchmark()

        # Save raw data
        runner.save_raw_data(df_optimized, df_unoptimized)

        # Perform statistical tests
        stats_results = runner.perform_statistical_tests(df_optimized, df_unoptimized)

        # Create visualizations
        runner.create_visualizations(df_optimized, df_unoptimized)

        # Generate report
        runner.generate_report(df_optimized, df_unoptimized, stats_results)

        # Print summary to console
        print("\n" + "=" * 80)
        print("BENCHMARK COMPLETED SUCCESSFULLY")
        print("=" * 80)

        summary = runner.calculate_statistics(df_optimized, df_unoptimized)
        print("\nSummary Statistics:")
        print(summary.to_string())

        print("\nStatistical Tests:")
        print(f"  TTFB t-test p-value: {stats_results['ttfb_t_test']['p_value']:.6f}")
        print(f"  Effect size (Cohen's d): {stats_results['ttfb_effect_size']['cohens_d']:.4f}")
        print(f"  Effect interpretation: {stats_results['ttfb_effect_size']['interpretation']}")

        print(f"\nResults saved to: {config.output_dir}")

    except Exception as e:
        logger.error(f"Benchmark failed: {e}", exc_info=True)
        raise


if __name__ == "__main__":
    main()
