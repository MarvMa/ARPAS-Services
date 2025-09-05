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
    """
    Measures different metrics of a request
    :param client:
    :param obj_id:
    :param obj_name:
    :param obj_size:
    :param mode:
    :param request_num:
    :return:
    """
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
    """
     Returns a Category for a given size in MB
    :param size_bytes:
    :return:
    """
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

    print(f"\nResults saved to:")
    print(f"  CSV: {csv_file}")


if __name__ == "__main__":
    run_benchmark()
