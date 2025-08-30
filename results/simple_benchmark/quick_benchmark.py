#!/usr/bin/env python3
"""
Quick Storage Service Benchmark
A simplified version for rapid testing
"""

import json
import statistics
import time
from typing import List, Dict

import requests


def preload_cache(base_url: str = "http://localhost:8000") -> bool:
    """Preload all objects into cache"""
    print("Preloading cache...")
    try:
        response = requests.post(f"{base_url}/cache/preload-all", timeout=120)
        result = response.json()
        print(f"Cache preload: {result.get('status')}")
        return result.get('status') == 'success'
    except Exception as e:
        print(f"Cache preload failed: {e}")
        return False


def get_object_ids(base_url: str = "http://localhost:8000") -> List[str]:
    """Get all object IDs"""
    response = requests.get(f"{base_url}/api/storage/objects")
    objects = response.json()
    return [obj['ID'] for obj in objects]


def benchmark_download(base_url: str, object_id: str, optimized: bool) -> Dict:
    """Benchmark a single download"""
    headers = {'X-Optimization-Mode': 'optimized'} if optimized else {}
    url = f"{base_url}/api/storage/objects/{object_id}/download"

    start = time.perf_counter()
    response = requests.get(url, headers=headers, stream=True)
    ttfb = (time.perf_counter() - start) * 1000  # ms

    # Download content
    content = b''
    for chunk in response.iter_content(chunk_size=8192):
        content += chunk

    total_time = (time.perf_counter() - start) * 1000  # ms

    return {
        'ttfb': ttfb,
        'total_time': total_time,
        'size': len(content),
        'server_latency': float(response.headers.get('X-Latency-Ms', 0)),
        'cache_hit': response.headers.get('X-Cache-Hit', 'false').lower() == 'true',
        'source': response.headers.get('X-Download-Source', 'unknown')
    }


def run_quick_benchmark(num_requests: int = 50):
    """Run a quick benchmark test"""
    base_url = "http://localhost:8000"

    # Preload cache
    if not preload_cache(base_url):
        print("Warning: Cache preload failed")

    # Get object IDs
    object_ids = get_object_ids(base_url)
    if not object_ids:
        print("No objects found!")
        return

    print(f"Found {len(object_ids)} objects")

    results = {'optimized': [], 'unoptimized': []}

    # Test optimized mode
    print(f"\nTesting OPTIMIZED mode ({num_requests} requests)...")
    for i in range(num_requests):
        object_id = object_ids[i % len(object_ids)]
        result = benchmark_download(base_url, object_id, optimized=True)
        results['optimized'].append(result)
        if (i + 1) % 10 == 0:
            print(f"  Progress: {i + 1}/{num_requests}")

    # Wait between tests
    time.sleep(2)

    # Test unoptimized mode
    print(f"\nTesting UNOPTIMIZED mode ({num_requests} requests)...")
    for i in range(num_requests):
        object_id = object_ids[i % len(object_ids)]
        result = benchmark_download(base_url, object_id, optimized=False)
        results['unoptimized'].append(result)
        if (i + 1) % 10 == 0:
            print(f"  Progress: {i + 1}/{num_requests}")

    # Calculate statistics
    print("\n" + "=" * 60)
    print("RESULTS")
    print("=" * 60)

    for mode in ['optimized', 'unoptimized']:
        ttfb_values = [r['ttfb'] for r in results[mode]]
        total_values = [r['total_time'] for r in results[mode]]
        cache_hits = sum(1 for r in results[mode] if r['cache_hit'])

        print(f"\n{mode.upper()} Mode:")
        print(f"  TTFB:")
        print(f"    Mean: {statistics.mean(ttfb_values):.2f} ms")
        print(f"    Median: {statistics.median(ttfb_values):.2f} ms")
        print(f"    Min: {min(ttfb_values):.2f} ms")
        print(f"    Max: {max(ttfb_values):.2f} ms")
        print(f"    Std Dev: {statistics.stdev(ttfb_values):.2f} ms")
        print(f"  Total Latency:")
        print(f"    Mean: {statistics.mean(total_values):.2f} ms")
        print(f"    Median: {statistics.median(total_values):.2f} ms")
        print(f"  Cache Hits: {cache_hits}/{len(results[mode])} ({cache_hits / len(results[mode]) * 100:.1f}%)")

    # Calculate improvement
    opt_ttfb_mean = statistics.mean([r['ttfb'] for r in results['optimized']])
    unopt_ttfb_mean = statistics.mean([r['ttfb'] for r in results['unoptimized']])
    improvement = ((unopt_ttfb_mean - opt_ttfb_mean) / unopt_ttfb_mean) * 100

    print("\n" + "=" * 60)
    print(f"IMPROVEMENT: {improvement:.1f}% faster TTFB with optimization")
    print("=" * 60)

    # Save results to JSON
    with open('quick_benchmark_results.json', 'w') as f:
        json.dump(results, f, indent=2)
    print("\nDetailed results saved to quick_benchmark_results.json")


if __name__ == "__main__":
    run_quick_benchmark(num_requests=50)
