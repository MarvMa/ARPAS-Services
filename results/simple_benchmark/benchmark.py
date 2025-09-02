import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

import pandas as pd
import requests


class BenchmarkConfig:
    def __init__(self):
        self.base_url = "http://localhost:8000"
        self.requests_per_object = 10
        self.concurrent_requests = 10
        self.warmup_requests = 2
        self.timeout = 30
        self.output_dir = Path("benchmark_results")
        self.output_dir.mkdir(exist_ok=True)


class HTTPClient:
    def __init__(self, base_url, timeout=30):
        self.base_url = base_url
        self.timeout = timeout
        self.session = requests.Session()
        adapter = requests.adapters.HTTPAdapter(pool_connections=20, pool_maxsize=20)
        self.session.mount('http://', adapter)

    def get(self, path, headers=None, stream=False):
        return self.session.get(f"{self.base_url}{path}", headers=headers, stream=stream, timeout=self.timeout)

    def post(self, path, timeout=None):
        return self.session.post(f"{self.base_url}{path}", timeout=timeout or self.timeout)


def measure_request(client, obj_id, obj_name, obj_size, mode, request_num):
    headers = {'X-Optimization-Mode': 'optimized'} if mode == 'optimized' else {}
    path = f"/api/storage/objects/{obj_id}/download"

    try:
        start = time.perf_counter()
        response = client.get(path, headers=headers, stream=True)
        ttfb = (time.perf_counter() - start) * 1000

        content_chunks = []
        for chunk in response.iter_content(chunk_size=65536):
            if chunk:
                content_chunks.append(chunk)

        total_latency = (time.perf_counter() - start) * 1000
        content_size = sum(len(chunk) for chunk in content_chunks)

        response.close()

        return {
            'object_id': obj_id,
            'object_name': obj_name,
            'file_size_mb': obj_size / 1_000_000,
            'mode': mode,
            'request_num': request_num,
            'ttfb_ms': round(ttfb, 2),
            'total_latency_ms': round(total_latency, 2),
            'transfer_time_ms': round(total_latency - ttfb, 2),
            'content_size': content_size,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        return None


def get_size_category(size_bytes):
    if size_bytes < 100_000:
        return "0-100KB"
    elif size_bytes < 500_000:
        return "100-500KB"
    elif size_bytes < 1_000_000:
        return "500KB-1MB"
    elif size_bytes < 5_000_000:
        return "1-5MB"
    elif size_bytes < 10_000_000:
        return "5-10MB"
    else:
        return ">10MB"


def run_benchmark():
    config = BenchmarkConfig()
    client = HTTPClient(config.base_url, config.timeout)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    print("Starting benchmark...")

    response = client.get("/api/storage/objects")
    objects = response.json()
    objects.sort(key=lambda x: x.get('Size', 0))

    print(f"Testing {len(objects)} objects with {config.requests_per_object} requests each")

    client.post("/cache/preload-all", timeout=120)
    time.sleep(2)

    all_results = []

    for mode in ['optimized', 'unoptimized']:
        print(f"Testing {mode} mode...")

        for obj in objects:
            obj_id = obj['ID']
            obj_name = obj.get('OriginalFilename', obj_id)
            obj_size = obj.get('Size', 0)

            with ThreadPoolExecutor(max_workers=config.concurrent_requests) as executor:
                futures = []
                for i in range(config.requests_per_object):
                    future = executor.submit(measure_request, client, obj_id, obj_name, obj_size, mode, i)
                    futures.append(future)

                for future in as_completed(futures):
                    result = future.result()
                    if result:
                        result['size_category'] = get_size_category(obj_size)
                        all_results.append(result)

        if mode == 'optimized':
            time.sleep(5)

    df = pd.DataFrame(all_results)

    csv_file = config.output_dir / f"benchmark_results_{timestamp}.csv"
    df.to_csv(csv_file, index=False)

    by_object = df.groupby(['object_id', 'object_name', 'file_size_mb', 'size_category', 'mode']).agg({
        'ttfb_ms': ['mean', 'std'],
        'total_latency_ms': ['mean', 'std'],
        'transfer_time_ms': 'mean'
    }).reset_index()

    by_object.columns = ['object_id', 'object_name', 'file_size_mb', 'size_category', 'mode',
                         'ttfb_mean', 'ttfb_std', 'total_mean', 'total_std', 'transfer_mean']

    results = []
    for obj_id in df['object_id'].unique():
        opt = by_object[(by_object['object_id'] == obj_id) & (by_object['mode'] == 'optimized')].iloc[0]
        unopt = by_object[(by_object['object_id'] == obj_id) & (by_object['mode'] == 'unoptimized')].iloc[0]

        ttfb_speedup = unopt['ttfb_mean'] / opt['ttfb_mean'] if opt['ttfb_mean'] > 0 else 0
        total_speedup = unopt['total_mean'] / opt['total_mean'] if opt['total_mean'] > 0 else 0

        results.append({
            'name': opt['object_name'][:30],
            'size_mb': opt['file_size_mb'],
            'category': opt['size_category'],
            'opt_ttfb': opt['ttfb_mean'],
            'unopt_ttfb': unopt['ttfb_mean'],
            'ttfb_speedup': ttfb_speedup,
            'opt_total': opt['total_mean'],
            'unopt_total': unopt['total_mean'],
            'total_speedup': total_speedup,
            'opt_transfer': opt['transfer_mean'],
            'unopt_transfer': unopt['transfer_mean']
        })

    results_df = pd.DataFrame(results)
    results_df = results_df.sort_values('size_mb')

    by_category = results_df.groupby('category').agg({
        'opt_ttfb': 'mean',
        'unopt_ttfb': 'mean',
        'ttfb_speedup': 'mean',
        'opt_total': 'mean',
        'unopt_total': 'mean',
        'total_speedup': 'mean',
        'size_mb': ['mean', 'count']
    }).round(2)

    report_file = config.output_dir / f"benchmark_report_{timestamp}.txt"
    with open(report_file, 'w') as f:
        f.write("STORAGE SERVICE BENCHMARK RESULTS\n")
        f.write("=" * 80 + "\n\n")

        f.write("TEST CONFIGURATION\n")
        f.write("-" * 40 + "\n")
        f.write(f"Objects tested: {len(objects)}\n")
        f.write(f"Requests per object: {config.requests_per_object}\n")
        f.write(f"Concurrent requests: {config.concurrent_requests}\n\n")

        f.write("AGGREGATE RESULTS BY SIZE CATEGORY\n")
        f.write("-" * 40 + "\n")
        f.write(f"{'Category':<12} {'Files':<6} {'TTFB (ms)':<25} {'Total (ms)':<25} {'Speedup':<15}\n")
        f.write(
            f"{'':<12} {'':<6} {'Opt':<8} {'Unopt':<8} {'Diff':<8} {'Opt':<8} {'Unopt':<8} {'Diff':<8} {'TTFB':<7} {'Total':<7}\n")
        f.write("-" * 80 + "\n")

        categories_order = ['0-100KB', '100-500KB', '500KB-1MB', '1-5MB', '5-10MB', '>10MB']
        for cat in categories_order:
            if cat in by_category.index:
                row = by_category.loc[cat]
                opt_ttfb = row['opt_ttfb']['mean']
                unopt_ttfb = row['unopt_ttfb']['mean']
                opt_total = row['opt_total']['mean']
                unopt_total = row['unopt_total']['mean']
                ttfb_diff = unopt_ttfb - opt_ttfb
                total_diff = unopt_total - opt_total

                f.write(f"{cat:<12} {int(row['size_mb']['count']):<6} "
                        f"{opt_ttfb:<8.1f} {unopt_ttfb:<8.1f} {ttfb_diff:<8.1f} "
                        f"{opt_total:<8.1f} {unopt_total:<8.1f} {total_diff:<8.1f} "
                        f"{row['ttfb_speedup']['mean']:<7.2f}x {row['total_speedup']['mean']:<7.2f}x\n")

        overall_ttfb_speedup = results_df['ttfb_speedup'].mean()
        overall_total_speedup = results_df['total_speedup'].mean()

        f.write("-" * 80 + "\n")
        f.write(f"{'OVERALL':<12} {len(results_df):<6} "
                f"{results_df['opt_ttfb'].mean():<8.1f} {results_df['unopt_ttfb'].mean():<8.1f} "
                f"{results_df['unopt_ttfb'].mean() - results_df['opt_ttfb'].mean():<8.1f} "
                f"{results_df['opt_total'].mean():<8.1f} {results_df['unopt_total'].mean():<8.1f} "
                f"{results_df['unopt_total'].mean() - results_df['opt_total'].mean():<8.1f} "
                f"{overall_ttfb_speedup:<7.2f}x {overall_total_speedup:<7.2f}x\n\n")

        f.write("CACHE EFFICIENCY ANALYSIS\n")
        f.write("-" * 40 + "\n")

        efficiency_scores = []
        for cat in categories_order:
            if cat in by_category.index:
                row = by_category.loc[cat]
                ttfb_improvement = (row['unopt_ttfb']['mean'] - row['opt_ttfb']['mean']) / row['unopt_ttfb'][
                    'mean'] * 100
                total_improvement = (row['unopt_total']['mean'] - row['opt_total']['mean']) / row['unopt_total'][
                    'mean'] * 100
                avg_size = results_df[results_df['category'] == cat]['size_mb'].mean()
                efficiency = ttfb_improvement / avg_size if avg_size > 0 else 0

                efficiency_scores.append({
                    'category': cat,
                    'ttfb_improvement_%': ttfb_improvement,
                    'total_improvement_%': total_improvement,
                    'avg_size_mb': avg_size,
                    'efficiency_score': efficiency,
                    'recommendation': 'CACHE' if ttfb_improvement > 20 and total_improvement > 10 else 'SKIP'
                })

        for item in efficiency_scores:
            f.write(f"\n{item['category']}:\n")
            f.write(f"  Average size: {item['avg_size_mb']:.2f} MB\n")
            f.write(f"  TTFB improvement: {item['ttfb_improvement_%']:.1f}%\n")
            f.write(f"  Total improvement: {item['total_improvement_%']:.1f}%\n")
            f.write(f"  Efficiency score: {item['efficiency_score']:.2f}\n")
            f.write(f"  Recommendation: {item['recommendation']}\n")

        f.write("\n" + "=" * 80 + "\n")
        f.write("SCIENTIFIC FINDINGS AND RECOMMENDATIONS\n")
        f.write("=" * 80 + "\n\n")

        f.write("1. PERFORMANCE CHARACTERISTICS\n")
        f.write("-" * 40 + "\n")

        best_category = max(efficiency_scores, key=lambda x: x['ttfb_improvement_%'])
        worst_category = min(efficiency_scores, key=lambda x: x['ttfb_improvement_%'])

        f.write(f"Best performing category: {best_category['category']} "
                f"({best_category['ttfb_improvement_%']:.1f}% TTFB improvement)\n")
        f.write(f"Worst performing category: {worst_category['category']} "
                f"({worst_category['ttfb_improvement_%']:.1f}% TTFB improvement)\n\n")

        f.write("2. CACHING RECOMMENDATIONS\n")
        f.write("-" * 40 + "\n")

        cache_categories = [e for e in efficiency_scores if e['recommendation'] == 'CACHE']
        skip_categories = [e for e in efficiency_scores if e['recommendation'] == 'SKIP']

        f.write("Categories to CACHE:\n")
        for item in cache_categories:
            f.write(f"  - {item['category']}: {item['ttfb_improvement_%']:.1f}% improvement\n")

        f.write("\nCategories to SKIP:\n")
        for item in skip_categories:
            f.write(f"  - {item['category']}: {item['ttfb_improvement_%']:.1f}% improvement (insufficient benefit)\n")

        f.write("\n3. ANALYSIS SUMMARY\n")
        f.write("-" * 40 + "\n")

        if overall_ttfb_speedup > 1.0:
            f.write(f"The caching strategy provides an overall speedup of {overall_ttfb_speedup:.2f}x for TTFB.\n")
        else:
            f.write(f"The caching strategy shows degraded performance ({overall_ttfb_speedup:.2f}x).\n")

        optimal_threshold = 5.0
        recommended_categories = [e['category'] for e in efficiency_scores
                                  if e['avg_size_mb'] < optimal_threshold and e['ttfb_improvement_%'] > 20]

        if recommended_categories:
            f.write(f"\nOptimal caching strategy: Cache files in categories {', '.join(recommended_categories)}\n")
            f.write(f"This corresponds to files smaller than {optimal_threshold} MB with >20% improvement.\n")
        else:
            f.write("\nNo clear caching benefit detected. Consider alternative optimization strategies.\n")

    print(f"\nResults saved to:")
    print(f"  CSV: {csv_file}")
    print(f"  Report: {report_file}")

    print("\nKey Findings:")
    for cat in categories_order:
        if cat in by_category.index:
            row = by_category.loc[cat]
            print(f"  {cat}: {row['ttfb_speedup']['mean']:.2f}x speedup")


if __name__ == "__main__":
    run_benchmark()
