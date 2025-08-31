import logging
import time
import warnings
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple, Optional, Any

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
        logging.FileHandler('benchmark.log', encoding='utf-8'),
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
    # Size analysis configuration
    size_buckets: List[Tuple[int, int]] = field(default_factory=lambda: [
        (0, 1024),  # 0-1KB
        (1024, 10240),  # 1-10KB
        (10240, 102400),  # 10-100KB
        (102400, 1048576),  # 100KB-1MB
        (1048576, 5242880),  # 1-5MB
        (5242880, 10485760),  # 5-10MB
        (10485760, float('inf'))  # >10MB
    ])

    def __post_init__(self):
        self.output_dir.mkdir(parents=True, exist_ok=True)


@dataclass
class RequestMetrics:
    """Enhanced metrics including file size information"""
    object_id: str
    mode: str  # 'optimized' or 'unoptimized'
    ttfb: float  # Time to first byte in ms
    total_latency: float  # Total request time in ms
    server_latency: float  # Server-reported latency in ms
    download_size: int  # Size in bytes
    file_size: int  # Actual file size in bytes (from metadata)
    cache_hit: bool
    download_source: str
    timestamp: datetime
    request_number: int
    thread_id: int
    throughput: float = 0.0  # MB/s

    def __post_init__(self):
        # Calculate throughput in MB/s
        if self.total_latency > 0:
            self.throughput = (self.file_size / 1048576) / (self.total_latency / 1000)

    def to_dict(self) -> Dict:
        """Convert to dictionary for DataFrame"""
        data = asdict(self)
        data['timestamp'] = self.timestamp.isoformat()
        return data


class StorageServiceClient:
    """Enhanced client with file size metadata retrieval"""

    def __init__(self, config: BenchmarkConfig):
        self.config = config
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Storage-Benchmark/1.0'
        })
        self.object_metadata_cache = {}

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

    def get_all_objects_with_metadata(self) -> Dict[str, Dict]:
        """Retrieve all object IDs with their metadata including size"""
        logger.info("Fetching all objects with metadata...")
        try:
            response = self.session.get(
                f"{self.config.base_url}/api/storage/objects",
                timeout=self.config.timeout
            )
            response.raise_for_status()
            objects = response.json()

            # Create metadata dictionary
            metadata = {}
            for obj in objects:
                metadata[obj['ID']] = {
                    'id': obj['ID'],
                    'size': obj.get('Size', 0),
                    'name': obj.get('Name', ''),
                    'content_type': obj.get('ContentType', '')
                }

            self.object_metadata_cache = metadata
            logger.info(f"Found {len(metadata)} objects with metadata")

            # Log size distribution
            sizes = [m['size'] for m in metadata.values()]
            logger.info(f"Size distribution: min={min(sizes) / 1024:.2f}KB, "
                        f"max={max(sizes) / 1048576:.2f}MB, "
                        f"median={np.median(sizes) / 1024:.2f}KB")

            return metadata
        except Exception as e:
            logger.error(f"Failed to fetch object metadata: {e}")
            return {}

    def download_object(self, object_id: str, mode: str, request_num: int,
                        thread_id: int) -> Optional[RequestMetrics]:
        """Download a single object and measure performance"""
        headers = {}
        if mode == 'optimized':
            headers['X-Optimization-Mode'] = 'optimized'

        url = f"{self.config.base_url}/api/storage/objects/{object_id}/download"

        try:
            # Get file size from metadata
            file_size = self.object_metadata_cache.get(object_id, {}).get('size', 0)

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
                file_size=file_size,
                cache_hit=cache_hit,
                download_source=download_source,
                timestamp=datetime.now(),
                request_number=request_num,
                thread_id=thread_id
            )

        except Exception as e:
            logger.error(f"Request failed for {object_id} in {mode} mode: {e}")
            return None


class SizeAnalyzer:
    """Specialized analyzer for file size impact on performance"""

    def __init__(self, config: BenchmarkConfig):
        self.config = config

    def categorize_by_size(self, df: pd.DataFrame) -> pd.DataFrame:
        """Add size category to dataframe"""

        def get_size_category(size):
            for i, (min_size, max_size) in enumerate(self.config.size_buckets):
                if min_size <= size < max_size:
                    return i, f"{self._format_size(min_size)}-{self._format_size(max_size)}"
            return len(self.config.size_buckets), "Unknown"

        df['size_category_idx'], df['size_category'] = zip(*df['file_size'].map(get_size_category))
        return df

    def _format_size(self, size_bytes: int) -> str:
        """Format size in human-readable format"""
        if size_bytes == float('inf'):
            return ">20MB"  # Use ASCII-compatible string instead of infinity symbol
        elif size_bytes < 1024:
            return f"{size_bytes}B"
        elif size_bytes < 1048576:
            return f"{size_bytes / 1024:.0f}KB"
        else:
            return f"{size_bytes / 1048576:.1f}MB"

    def analyze_size_impact(self, df_opt: pd.DataFrame, df_unopt: pd.DataFrame) -> Dict[str, Any]:
        """Comprehensive analysis of size impact on performance"""
        results = {}

        # Add size categories
        df_opt = self.categorize_by_size(df_opt)
        df_unopt = self.categorize_by_size(df_unopt)

        # Group by size category
        size_stats = []
        for category in sorted(df_opt['size_category'].unique()):
            opt_group = df_opt[df_opt['size_category'] == category]
            unopt_group = df_unopt[df_unopt['size_category'] == category]

            if len(opt_group) > 0 and len(unopt_group) > 0:
                stats_entry = {
                    'size_category': category,
                    'count_optimized': len(opt_group),
                    'count_unoptimized': len(unopt_group),
                    'avg_size_mb': opt_group['file_size'].mean() / 1048576,
                    'opt_mean_ttfb': opt_group['ttfb'].mean(),
                    'opt_median_ttfb': opt_group['ttfb'].median(),
                    'opt_p95_ttfb': opt_group['ttfb'].quantile(0.95),
                    'unopt_mean_ttfb': unopt_group['ttfb'].mean(),
                    'unopt_median_ttfb': unopt_group['ttfb'].median(),
                    'unopt_p95_ttfb': unopt_group['ttfb'].quantile(0.95),
                    'opt_cache_hit_rate': opt_group['cache_hit'].mean() * 100,
                    'unopt_cache_hit_rate': unopt_group['cache_hit'].mean() * 100,
                    'opt_throughput_mbps': opt_group['throughput'].mean(),
                    'unopt_throughput_mbps': unopt_group['throughput'].mean(),
                    'improvement_mean': ((unopt_group['ttfb'].mean() - opt_group['ttfb'].mean()) /
                                         unopt_group['ttfb'].mean() * 100),
                    'improvement_median': ((unopt_group['ttfb'].median() - opt_group['ttfb'].median()) /
                                           unopt_group['ttfb'].median() * 100)
                }
                size_stats.append(stats_entry)

        results['size_category_stats'] = pd.DataFrame(size_stats)

        # Correlation analysis
        results['correlations'] = {
            'opt_size_ttfb_corr': df_opt['file_size'].corr(df_opt['ttfb']),
            'unopt_size_ttfb_corr': df_unopt['file_size'].corr(df_unopt['ttfb']),
            'opt_size_latency_corr': df_opt['file_size'].corr(df_opt['total_latency']),
            'unopt_size_latency_corr': df_unopt['file_size'].corr(df_unopt['total_latency'])
        }

        return results

    def detect_cache_threshold(self, df_opt: pd.DataFrame) -> Dict[str, Any]:
        """Detect the cache threshold based on performance characteristics"""
        threshold_results = {}

        # Sort by file size
        df_sorted = df_opt.sort_values('file_size')

        # Method 1: Analyze cache hit rate drop
        if 'cache_hit' in df_sorted.columns:
            # Create rolling window for cache hit rate
            window_size = max(5, len(df_sorted) // 20)
            df_sorted['rolling_cache_hit'] = df_sorted['cache_hit'].rolling(
                window=window_size, center=True).mean()

            # Find steepest drop in cache hit rate
            cache_hit_gradient = np.gradient(df_sorted['rolling_cache_hit'].fillna(0))
            if len(cache_hit_gradient) > 0:
                steepest_drop_idx = np.argmin(cache_hit_gradient)
                threshold_cache = df_sorted.iloc[steepest_drop_idx]['file_size']
                threshold_results['cache_hit_threshold'] = threshold_cache

        # Method 2: Analyze TTFB increase
        # Create size bins for analysis
        size_bins = np.percentile(df_sorted['file_size'], np.arange(0, 101, 5))
        df_sorted['size_bin'] = pd.cut(df_sorted['file_size'], bins=size_bins, labels=False)

        # Calculate mean TTFB per bin
        bin_stats = df_sorted.groupby('size_bin')['ttfb'].agg(['mean', 'std', 'count'])
        bin_stats['file_size'] = df_sorted.groupby('size_bin')['file_size'].mean()

        # Find inflection point using gradient
        ttfb_gradient = np.gradient(bin_stats['mean'].fillna(bin_stats['mean'].mean()))
        if len(ttfb_gradient) > 1:
            # Look for significant change in gradient
            gradient_change = np.diff(ttfb_gradient)
            if len(gradient_change) > 0:
                inflection_idx = np.argmax(np.abs(gradient_change)) + 1
                threshold_ttfb = bin_stats.iloc[inflection_idx]['file_size']
                threshold_results['ttfb_threshold'] = threshold_ttfb

        # Method 3: Statistical changepoint detection
        try:
            from ruptures import Pelt
            # Use changepoint detection on TTFB vs size
            signal = df_sorted['ttfb'].values.reshape(-1, 1)
            algo = Pelt(model="rbf").fit(signal)
            change_points = algo.predict(pen=10)

            if len(change_points) > 1:
                # Get the most significant changepoint
                main_change = change_points[0]
                threshold_changepoint = df_sorted.iloc[main_change]['file_size']
                threshold_results['changepoint_threshold'] = threshold_changepoint
        except ImportError:
            logger.warning("ruptures library not available for changepoint detection")

        # Method 4: Elbow method on performance degradation
        sizes = df_sorted['file_size'].values
        ttfbs = df_sorted['ttfb'].values

        # Normalize for elbow detection
        sizes_norm = (sizes - sizes.min()) / (sizes.max() - sizes.min())
        ttfbs_norm = (ttfbs - ttfbs.min()) / (ttfbs.max() - ttfbs.min())

        # Calculate distances from line connecting first and last point
        p1 = np.array([sizes_norm[0], ttfbs_norm[0]])
        p2 = np.array([sizes_norm[-1], ttfbs_norm[-1]])

        distances = []
        for i in range(len(sizes_norm)):
            p = np.array([sizes_norm[i], ttfbs_norm[i]])
            distance = np.abs(np.cross(p2 - p1, p1 - p)) / np.linalg.norm(p2 - p1)
            distances.append(distance)

        elbow_idx = np.argmax(distances)
        threshold_elbow = sizes[elbow_idx]
        threshold_results['elbow_threshold'] = threshold_elbow

        # Consensus threshold (weighted average of methods)
        thresholds = []
        weights = []

        if 'cache_hit_threshold' in threshold_results:
            thresholds.append(threshold_results['cache_hit_threshold'])
            weights.append(2.0)  # Higher weight for direct cache measurement

        if 'ttfb_threshold' in threshold_results:
            thresholds.append(threshold_results['ttfb_threshold'])
            weights.append(1.5)

        if 'elbow_threshold' in threshold_results:
            thresholds.append(threshold_results['elbow_threshold'])
            weights.append(1.0)

        if thresholds:
            threshold_results['recommended_threshold'] = np.average(thresholds, weights=weights)
            threshold_results['threshold_std'] = np.std(thresholds)
            threshold_results['confidence'] = 1 - (threshold_results['threshold_std'] /
                                                   threshold_results['recommended_threshold'])

        return threshold_results


class EnhancedBenchmarkRunner:
    """Enhanced benchmark runner with size-aware analysis"""

    def __init__(self, config: BenchmarkConfig):
        self.config = config
        self.client = StorageServiceClient(config)
        self.size_analyzer = SizeAnalyzer(config)
        self.results: List[RequestMetrics] = []
        self.timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    def run_benchmark_for_mode(self, object_metadata: Dict[str, Dict], mode: str) -> List[RequestMetrics]:
        """Run benchmark for a specific mode with size awareness"""
        logger.info(f"Starting benchmark for {mode} mode")
        metrics = []

        # Sort objects by size for better distribution
        sorted_objects = sorted(object_metadata.items(), key=lambda x: x[1]['size'])
        object_ids = [obj_id for obj_id, _ in sorted_objects]

        # Ensure we test all size ranges
        request_queue = []
        for i in range(self.config.num_requests):
            # Use modulo to cycle through all objects
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
                    hash(executor) % 1000
                )
                futures.append(future)

            # Collect results
            for i, future in enumerate(as_completed(futures)):
                result = future.result()
                if result:
                    metrics.append(result)
                if (i + 1) % 10 == 0:
                    logger.info(f"Progress: {i + 1}/{self.config.num_requests} requests completed")

        logger.info(f"Completed {len(metrics)} successful requests for {mode} mode")
        return metrics

    def run_full_benchmark(self) -> Tuple[pd.DataFrame, pd.DataFrame]:
        """Run complete benchmark with size analysis"""
        # Preload cache
        if not self.client.preload_all_cache():
            logger.warning("Cache preload failed, continuing anyway...")
            time.sleep(2)

        # Get objects with metadata
        object_metadata = self.client.get_all_objects_with_metadata()
        if not object_metadata:
            raise ValueError("No objects found in storage service")

        # Run benchmarks
        optimized_metrics = self.run_benchmark_for_mode(object_metadata, 'optimized')

        logger.info("Waiting 5 seconds before unoptimized test...")
        time.sleep(5)

        unoptimized_metrics = self.run_benchmark_for_mode(object_metadata, 'unoptimized')

        # Convert to DataFrames
        df_optimized = pd.DataFrame([m.to_dict() for m in optimized_metrics])
        df_unoptimized = pd.DataFrame([m.to_dict() for m in unoptimized_metrics])

        return df_optimized, df_unoptimized

    def create_size_visualizations(self, df_opt: pd.DataFrame, df_unopt: pd.DataFrame,
                                   size_analysis: Dict, threshold_results: Dict):
        """Create comprehensive visualizations for size analysis"""
        # Add size categories
        df_opt = self.size_analyzer.categorize_by_size(df_opt)
        df_unopt = self.size_analyzer.categorize_by_size(df_unopt)

        # Create figure with subplots
        fig = plt.figure(figsize=(24, 20))

        # 1. TTFB vs File Size Scatter
        ax1 = plt.subplot(4, 4, 1)
        ax1.scatter(df_opt['file_size'] / 1048576, df_opt['ttfb'], alpha=0.5, label='Optimized', s=20)
        ax1.scatter(df_unopt['file_size'] / 1048576, df_unopt['ttfb'], alpha=0.5, label='Unoptimized', s=20)
        ax1.set_xlabel('File Size (MB)')
        ax1.set_ylabel('TTFB (ms)')
        ax1.set_title('TTFB vs File Size')
        ax1.set_xscale('log')
        ax1.legend()
        ax1.grid(True, alpha=0.3)

        # Add threshold line if detected
        if 'recommended_threshold' in threshold_results:
            ax1.axvline(x=threshold_results['recommended_threshold'] / 1048576,
                        color='red', linestyle='--', label='Threshold', linewidth=2)

        # 2. Cache Hit Rate by Size Category
        ax2 = plt.subplot(4, 4, 2)
        size_stats = size_analysis['size_category_stats']
        x = np.arange(len(size_stats))
        width = 0.35
        ax2.bar(x - width / 2, size_stats['opt_cache_hit_rate'], width, label='Optimized')
        ax2.bar(x + width / 2, size_stats['unopt_cache_hit_rate'], width, label='Unoptimized')
        ax2.set_xlabel('Size Category')
        ax2.set_ylabel('Cache Hit Rate (%)')
        ax2.set_title('Cache Hit Rate by File Size Category')
        ax2.set_xticks(x)
        ax2.set_xticklabels(size_stats['size_category'], rotation=45, ha='right')
        ax2.legend()
        ax2.grid(True, alpha=0.3)

        # 3. Performance Improvement by Size
        ax3 = plt.subplot(4, 4, 3)
        ax3.bar(x, size_stats['improvement_mean'])
        ax3.set_xlabel('Size Category')
        ax3.set_ylabel('Performance Improvement (%)')
        ax3.set_title('Mean TTFB Improvement by Size Category')
        ax3.set_xticks(x)
        ax3.set_xticklabels(size_stats['size_category'], rotation=45, ha='right')
        ax3.axhline(y=0, color='black', linestyle='-', linewidth=0.5)
        ax3.grid(True, alpha=0.3)

        # 4. Throughput vs File Size
        ax4 = plt.subplot(4, 4, 4)
        ax4.scatter(df_opt['file_size'] / 1048576, df_opt['throughput'],
                    alpha=0.5, label='Optimized', s=20)
        ax4.scatter(df_unopt['file_size'] / 1048576, df_unopt['throughput'],
                    alpha=0.5, label='Unoptimized', s=20)
        ax4.set_xlabel('File Size (MB)')
        ax4.set_ylabel('Throughput (MB/s)')
        ax4.set_title('Download Throughput vs File Size')
        ax4.set_xscale('log')
        ax4.legend()
        ax4.grid(True, alpha=0.3)

        # 5. Box plots by size category
        ax5 = plt.subplot(4, 4, 5)
        df_combined = pd.concat([
            df_opt.assign(mode='Optimized'),
            df_unopt.assign(mode='Unoptimized')
        ])
        sns.boxplot(data=df_combined, x='size_category', y='ttfb', hue='mode', ax=ax5)
        ax5.set_xlabel('Size Category')
        ax5.set_ylabel('TTFB (ms)')
        ax5.set_title('TTFB Distribution by Size Category')
        ax5.tick_params(axis='x', rotation=45)

        # 6. Cumulative latency by size
        ax6 = plt.subplot(4, 4, 6)
        for category in sorted(df_opt['size_category'].unique()):
            opt_data = df_opt[df_opt['size_category'] == category]['ttfb'].values
            if len(opt_data) > 0:
                sorted_data = np.sort(opt_data)
                p = np.arange(1, len(sorted_data) + 1) / len(sorted_data)
                ax6.plot(sorted_data, p, label=category, linewidth=2)
        ax6.set_xlabel('TTFB (ms)')
        ax6.set_ylabel('Cumulative Probability')
        ax6.set_title('CDF by Size Category (Optimized)')
        ax6.legend(bbox_to_anchor=(1.05, 1), loc='upper left')
        ax6.grid(True, alpha=0.3)

        # 7. Heatmap of performance metrics
        ax7 = plt.subplot(4, 4, 7)
        heatmap_data = size_stats[['opt_mean_ttfb', 'unopt_mean_ttfb', 'improvement_mean']].T
        sns.heatmap(heatmap_data, annot=True, fmt='.1f', cmap='RdYlGn_r', ax=ax7,
                    xticklabels=size_stats['size_category'])
        ax7.set_title('Performance Metrics Heatmap')
        ax7.set_ylabel('Metric')

        # 8. Threshold detection visualization
        ax8 = plt.subplot(4, 4, 8)
        sizes = df_opt.sort_values('file_size')['file_size'].values / 1048576
        ttfbs = df_opt.sort_values('file_size')['ttfb'].values
        ax8.scatter(sizes, ttfbs, alpha=0.3, s=10)

        # Smooth curve
        from scipy.signal import savgol_filter
        if len(ttfbs) > 50:
            window = min(51, len(ttfbs) // 2 * 2 - 1)  # Ensure odd window
            smooth_ttfb = savgol_filter(ttfbs, window, 3)
            ax8.plot(sizes, smooth_ttfb, 'r-', linewidth=2, label='Smoothed')

        # Mark all detected thresholds
        colors = ['red', 'blue', 'green', 'orange']
        threshold_types = ['cache_hit_threshold', 'ttfb_threshold', 'elbow_threshold', 'recommended_threshold']
        for i, threshold_type in enumerate(threshold_types):
            if threshold_type in threshold_results:
                value = threshold_results[threshold_type] / 1048576
                ax8.axvline(x=value, color=colors[i % len(colors)],
                            linestyle='--', label=threshold_type.replace('_', ' ').title(), alpha=0.7)

        ax8.set_xlabel('File Size (MB)')
        ax8.set_ylabel('TTFB (ms)')
        ax8.set_title('Threshold Detection Analysis')
        ax8.set_xscale('log')
        ax8.legend()
        ax8.grid(True, alpha=0.3)

        # 9-12: Statistical tests per size category
        for idx, (category, group_opt, group_unopt) in enumerate(
                [(cat, df_opt[df_opt['size_category'] == cat],
                  df_unopt[df_unopt['size_category'] == cat])
                 for cat in sorted(df_opt['size_category'].unique())[:4]]):

            ax = plt.subplot(4, 4, 9 + idx)
            if len(group_opt) > 0 and len(group_unopt) > 0:
                # Q-Q plot for normality check
                stats.probplot(group_opt['ttfb'], dist="norm", plot=ax)
                ax.set_title(f'Q-Q Plot: {category}')

        # 13. Size distribution histogram
        ax13 = plt.subplot(4, 4, 13)
        ax13.hist(df_opt['file_size'] / 1048576, bins=50, alpha=0.7, edgecolor='black')
        ax13.set_xlabel('File Size (MB)')
        ax13.set_ylabel('Count')
        ax13.set_title('File Size Distribution')
        ax13.set_xscale('log')
        ax13.grid(True, alpha=0.3)

        # 14. Correlation matrix
        ax14 = plt.subplot(4, 4, 14)
        corr_data = df_opt[['file_size', 'ttfb', 'total_latency', 'throughput']].corr()
        sns.heatmap(corr_data, annot=True, fmt='.2f', cmap='coolwarm', center=0, ax=ax14)
        ax14.set_title('Correlation Matrix (Optimized)')

        # 15. Performance stability by size
        ax15 = plt.subplot(4, 4, 15)
        for category in sorted(df_opt['size_category'].unique()):
            cat_data = df_opt[df_opt['size_category'] == category]
            if len(cat_data) > 0:
                ax15.scatter(cat_data['request_number'], cat_data['ttfb'],
                             alpha=0.5, label=category, s=10)
        ax15.set_xlabel('Request Number')
        ax15.set_ylabel('TTFB (ms)')
        ax15.set_title('Performance Stability by Size Category')
        ax15.legend(bbox_to_anchor=(1.05, 1), loc='upper left')
        ax15.grid(True, alpha=0.3)

        # 16. Summary statistics text
        ax16 = plt.subplot(4, 4, 16)
        ax16.axis('off')

        summary_text = f"""Threshold Analysis Summary:
        
Recommended Threshold: {threshold_results.get('recommended_threshold', 0) / 1048576:.2f} MB
Confidence: {threshold_results.get('confidence', 0) * 100:.1f}%

Detection Methods:
- Cache Hit: {threshold_results.get('cache_hit_threshold', 0) / 1048576:.2f} MB
- TTFB Analysis: {threshold_results.get('ttfb_threshold', 0) / 1048576:.2f} MB
- Elbow Method: {threshold_results.get('elbow_threshold', 0) / 1048576:.2f} MB

Size Correlations:
- Size vs TTFB (Opt): {size_analysis['correlations']['opt_size_ttfb_corr']:.3f}
- Size vs TTFB (Unopt): {size_analysis['correlations']['unopt_size_ttfb_corr']:.3f}
- Size vs Latency (Opt): {size_analysis['correlations']['opt_size_latency_corr']:.3f}
        """
        ax16.text(0.1, 0.9, summary_text, transform=ax16.transAxes, fontsize=10,
                  verticalalignment='top', fontfamily='monospace')

        plt.suptitle(f'Storage Service Size-Aware Performance Analysis - {self.timestamp}',
                     fontsize=16, y=1.02)
        plt.tight_layout()

        # Save figure
        output_file = self.config.output_dir / f"size_analysis_{self.timestamp}.png"
        plt.savefig(output_file, dpi=300, bbox_inches='tight')
        logger.info(f"Size analysis visualization saved to {output_file}")
        plt.close()

    def generate_size_report(self, df_opt: pd.DataFrame, df_unopt: pd.DataFrame,
                             size_analysis: Dict, threshold_results: Dict):
        """Generate comprehensive report with size analysis"""
        report_file = self.config.output_dir / f"size_benchmark_report_{self.timestamp}.txt"

        with open(report_file, 'w', encoding='utf-8') as f:
            f.write("=" * 80 + "\n")
            f.write("STORAGE SERVICE SIZE-AWARE PERFORMANCE BENCHMARK REPORT\n")
            f.write("=" * 80 + "\n\n")

            f.write(f"Timestamp: {self.timestamp}\n")
            f.write(f"Configuration:\n")
            f.write(f"  - Base URL: {self.config.base_url}\n")
            f.write(f"  - Total Requests per Mode: {self.config.num_requests}\n")
            f.write(f"  - Concurrent Requests: {self.config.concurrent_requests}\n\n")

            f.write("-" * 80 + "\n")
            f.write("CACHE THRESHOLD ANALYSIS\n")
            f.write("-" * 80 + "\n\n")

            f.write(
                f"RECOMMENDED CACHE THRESHOLD: {threshold_results.get('recommended_threshold', 0) / 1048576:.2f} MB\n")
            f.write(f"Confidence Level: {threshold_results.get('confidence', 0) * 100:.1f}%\n")
            f.write(f"Standard Deviation: {threshold_results.get('threshold_std', 0) / 1048576:.2f} MB\n\n")

            f.write("Detection Methods:\n")
            for method, key in [
                ('Cache Hit Analysis', 'cache_hit_threshold'),
                ('TTFB Inflection', 'ttfb_threshold'),
                ('Elbow Method', 'elbow_threshold')
            ]:
                if key in threshold_results:
                    f.write(f"  - {method}: {threshold_results[key] / 1048576:.2f} MB\n")

            f.write("\n" + "-" * 80 + "\n")
            f.write("PERFORMANCE BY SIZE CATEGORY\n")
            f.write("-" * 80 + "\n\n")

            size_stats = size_analysis['size_category_stats']
            f.write(size_stats.to_string(index=False))

            f.write("\n\n" + "-" * 80 + "\n")
            f.write("SIZE CORRELATION ANALYSIS\n")
            f.write("-" * 80 + "\n\n")

            corr = size_analysis['correlations']
            f.write(f"File Size vs TTFB Correlation:\n")
            f.write(f"  - Optimized: {corr['opt_size_ttfb_corr']:.3f}\n")
            f.write(f"  - Unoptimized: {corr['unopt_size_ttfb_corr']:.3f}\n\n")
            f.write(f"File Size vs Total Latency Correlation:\n")
            f.write(f"  - Optimized: {corr['opt_size_latency_corr']:.3f}\n")
            f.write(f"  - Unoptimized: {corr['unopt_size_latency_corr']:.3f}\n\n")

            f.write("-" * 80 + "\n")
            f.write("RECOMMENDATIONS\n")
            f.write("-" * 80 + "\n\n")

            threshold_mb = threshold_results.get('recommended_threshold', 0) / 1048576
            f.write(f"1. Set memory cache maximum file size to {threshold_mb:.2f} MB\n")
            f.write(f"2. Files larger than {threshold_mb:.2f} MB should use disk cache or streaming\n")

            # Find best performing size category
            best_improvement = size_stats['improvement_mean'].max()
            best_category = size_stats.loc[size_stats['improvement_mean'].idxmax(), 'size_category']
            f.write(f"3. Best performance improvement ({best_improvement:.1f}%) observed for {best_category} files\n")

            # Check if larger files show degradation
            large_files = size_stats[size_stats['avg_size_mb'] > threshold_mb]
            if not large_files.empty:
                avg_large_improvement = large_files['improvement_mean'].mean()
                if avg_large_improvement < 10:
                    f.write(
                        f"4. Large files (>{threshold_mb:.1f}MB) show limited improvement ({avg_large_improvement:.1f}%)\n")
                    f.write(f"   Consider alternative optimization strategies for these files\n")

        logger.info(f"Size analysis report saved to {report_file}")

    def save_enhanced_data(self, df_opt: pd.DataFrame, df_unopt: pd.DataFrame,
                           size_analysis: Dict, threshold_results: Dict):
        """Save enhanced data with size analysis"""
        # Save raw data with size information
        excel_file = self.config.output_dir / f"size_benchmark_results_{self.timestamp}.xlsx"

        with pd.ExcelWriter(excel_file, engine='openpyxl') as writer:
            # Raw data sheets
            df_opt.to_excel(writer, sheet_name='Optimized_Raw', index=False)
            df_unopt.to_excel(writer, sheet_name='Unoptimized_Raw', index=False)

            # Size category statistics
            size_analysis['size_category_stats'].to_excel(
                writer, sheet_name='Size_Statistics', index=False)

            # Threshold analysis
            threshold_df = pd.DataFrame([threshold_results])
            threshold_df.to_excel(writer, sheet_name='Threshold_Analysis', index=False)

            # Correlation matrix
            corr_df = pd.DataFrame([size_analysis['correlations']])
            corr_df.to_excel(writer, sheet_name='Correlations', index=False)

        logger.info(f"Enhanced Excel report saved to {excel_file}")


def main():
    """Main execution function"""
    # Configuration
    config = BenchmarkConfig(
        base_url="http://localhost:8000",
        num_requests=200,  # Increased for better size coverage
        concurrent_requests=10,
        warmup_requests=10,
        timeout=30,
        size_buckets=[
            (0, 1024),  # 0-1KB
            (1024, 10240),  # 1-10KB
            (10240, 102400),  # 10-100KB
            (102400, 512000),  # 100-500KB
            (512000, 1048576),  # 500KB-1MB
            (1048576, 2097152),  # 1-2MB
            (2097152, 5242880),  # 2-5MB
            (5242880, 10485760),  # 5-10MB
            (10485760, 20971520),  # 10-20MB
            (20971520, float('inf'))  # >20MB
        ]
    )

    # Create enhanced benchmark runner
    runner = EnhancedBenchmarkRunner(config)

    try:
        # Run benchmark
        logger.info("Starting size-aware storage service benchmark...")
        df_optimized, df_unoptimized = runner.run_full_benchmark()

        # Perform size analysis
        size_analysis = runner.size_analyzer.analyze_size_impact(df_optimized, df_unoptimized)

        # Detect cache threshold
        threshold_results = runner.size_analyzer.detect_cache_threshold(df_optimized)

        # Create visualizations
        runner.create_size_visualizations(df_optimized, df_unoptimized,
                                          size_analysis, threshold_results)

        # Generate reports
        runner.generate_size_report(df_optimized, df_unoptimized,
                                    size_analysis, threshold_results)

        # Save enhanced data
        runner.save_enhanced_data(df_optimized, df_unoptimized,
                                  size_analysis, threshold_results)

        # Print summary to console
        print("\n" + "=" * 80)
        print("SIZE-AWARE BENCHMARK COMPLETED SUCCESSFULLY")
        print("=" * 80)

        print(
            f"\n[TARGET] RECOMMENDED CACHE THRESHOLD: {threshold_results.get('recommended_threshold', 0) / 1048576:.2f} MB")
        print(f"   Confidence: {threshold_results.get('confidence', 0) * 100:.1f}%")

        print("\n[STATS] Size Category Performance Summary:")
        size_stats = size_analysis['size_category_stats']
        for _, row in size_stats.iterrows():
            print(f"   {row['size_category']}: {row['improvement_mean']:.1f}% improvement")

        print(f"\n[OUTPUT] Results saved to: {config.output_dir}")

    except Exception as e:
        logger.error(f"Benchmark failed: {e}", exc_info=True)
        raise


if __name__ == "__main__":
    main()
