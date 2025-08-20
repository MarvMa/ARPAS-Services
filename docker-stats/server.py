from flask import Flask, jsonify, request
import docker
import os, threading, requests

PROMETHEUS_URL = os.getenv("PROMETHEUS_BASE_URL", "http://prometheus:9090")
HTTP_TIMEOUT = float(os.getenv("PROM_HTTP_TIMEOUT", "8"))

JOBS = {}  # jobId -> {"status": "pending"|"done"|"error", "result": {...}, "error": str}
JOBS_LOCK = threading.Lock()

app = Flask(__name__)
client = docker.from_env()


@app.get("/health")
def health():
    return jsonify({"status": "ok"}), 200

@app.post("/api/docker/metrics/historical")
def get_historical_metrics():
    """
    Get historical Docker metrics from Prometheus for a specific time range
    Request body:
    {
        "start_time": timestamp_ms,
        "end_time": timestamp_ms,
        "simulation_type": "optimized" | "unoptimized"
    }
    """
    try:
        data = request.get_json()

        if not data:
            return jsonify({"error": "Request body required"}), 400

        start_time = data.get('start_time')
        end_time = data.get('end_time')
        simulation_type = data.get('simulation_type', 'optimized')

        if not start_time or not end_time:
            return jsonify({"error": "start_time and end_time required"}), 400

        # Convert milliseconds to seconds for Prometheus
        start_timestamp = start_time / 1000
        end_timestamp = end_time / 1000

        # Define service groups based on simulation type
        if simulation_type == "optimized":
            service_labels = [
                "prediction_service",
                "storage-service",
                "redis",
                "minio"
            ]
        else:  # unoptimized
            service_labels = [
                "storage-service",
                "minio"
            ]

        print(f"Fetching metrics for {simulation_type} simulation from {start_timestamp} to {end_timestamp}")
        print(f"Services: {service_labels}")

        # Collect metrics for each service
        metrics_data = {}

        for service in service_labels:
            try:
                service_metrics = fetch_service_metrics(
                    service, start_timestamp, end_timestamp
                )
                if service_metrics:
                    metrics_data[service] = service_metrics
                    print(f"Successfully fetched {len(service_metrics)} data points for {service}")
                else:
                    print(f"No metrics found for service: {service}")
            except Exception as e:
                print(f"Error fetching metrics for service {service}: {str(e)}")
                # Continue with other services

        if not metrics_data:
            return jsonify({
                "error": "No metrics data found for the specified time range",
                "details": f"Services searched: {service_labels}"
            }), 404

        return jsonify({
            "simulation_type": simulation_type,
            "start_time": start_time,
            "end_time": end_time,
            "duration_ms": end_time - start_time,
            "services": list(metrics_data.keys()),
            "metrics": metrics_data
        }), 200

    except Exception as e:
        print(f"Error in get_historical_metrics: {str(e)}")
        return jsonify({"error": f"Failed to fetch historical metrics: {str(e)}"}), 500

def fetch_service_metrics(service_name, start_timestamp, end_timestamp):
    """Fetch comprehensive metrics for a specific service from Prometheus"""

    try:
        # Check Prometheus availability
        health_response = requests.get(f"{PROMETHEUS_URL}/-/healthy", timeout=5)
        if health_response.status_code != 200:
            print(f"Prometheus not healthy: {health_response.status_code}")
            return None

    except requests.exceptions.RequestException as e:
        print(f"Cannot connect to Prometheus: {str(e)}")
        return None

    # Define Prometheus queries for different metrics
    queries = {
        "cpu_percent": f'rate(container_cpu_usage_seconds_total{{name=~".*{service_name}.*"}}[30s]) * 100',
        "memory_usage": f'container_memory_usage_bytes{{name=~".*{service_name}.*"}}',
        "memory_limit": f'container_spec_memory_limit_bytes{{name=~".*{service_name}.*"}}',
        "network_rx": f'rate(container_network_receive_bytes_total{{name=~".*{service_name}.*"}}[30s])',
        "network_tx": f'rate(container_network_transmit_bytes_total{{name=~".*{service_name}.*"}}[30s])',
    }

    step = 1  # 1 second intervals

    # Calculate the number of expected data points
    duration = end_timestamp - start_timestamp
    expected_points = int(duration / step)

    print(f"Querying Prometheus for {service_name} over {duration}s with {expected_points} expected points")

    try:
        # Fetch all metrics and combine them by timestamp
        all_metrics = {}

        for metric_name, query in queries.items():
            try:
                params = {
                    'query': query,
                    'start': start_timestamp,
                    'end': end_timestamp,
                    'step': f'{step}s'
                }

                response = requests.get(
                    f"{PROMETHEUS_URL}/api/v1/query_range",
                    params=params,
                    timeout=30
                )

                if response.status_code == 200:
                    result = response.json()
                    if result.get('status') == 'success' and result.get('data', {}).get('result'):
                        # Process the time series data
                        for series in result['data']['result']:
                            container_name = extract_container_name(series.get('metric', {}), service_name)
                            values = series.get('values', [])

                            for timestamp_str, value_str in values:
                                timestamp_ms = int(float(timestamp_str) * 1000)

                                if timestamp_ms not in all_metrics:
                                    all_metrics[timestamp_ms] = {
                                        'timestamp': timestamp_ms,
                                        'container_name': container_name,
                                        'cpu': {'percent': 0},
                                        'memory': {'usage': 0, 'limit': 0, 'percent': 0},
                                        'network': {'rxRate': 0, 'txRate': 0, 'rxBytes': 0, 'txBytes': 0}
                                    }

                                # Parse the metric value
                                try:
                                    value = float(value_str)

                                    if metric_name == "cpu_percent":
                                        all_metrics[timestamp_ms]['cpu']['percent'] = round(value, 2)
                                    elif metric_name == "memory_usage":
                                        all_metrics[timestamp_ms]['memory']['usage'] = int(value)
                                    elif metric_name == "memory_limit":
                                        all_metrics[timestamp_ms]['memory']['limit'] = int(value)
                                    elif metric_name == "network_rx":
                                        all_metrics[timestamp_ms]['network']['rxRate'] = round(value, 2)
                                    elif metric_name == "network_tx":
                                        all_metrics[timestamp_ms]['network']['txRate'] = round(value, 2)

                                except (ValueError, TypeError):
                                    print(f"Could not parse value for {metric_name}: {value_str}")

                    else:
                        print(f"No data returned for {metric_name} query: {query}")

                else:
                    print(f"Prometheus query failed for {metric_name}: {response.status_code} - {response.text}")

            except Exception as e:
                print(f"Error querying {metric_name} for {service_name}: {str(e)}")

        # Convert to sorted time series
        time_series_data = []
        for timestamp in sorted(all_metrics.keys()):
            metrics = all_metrics[timestamp]

            # Calculate memory percentage
            if metrics['memory']['limit'] > 0:
                metrics['memory']['percent'] = round(
                    (metrics['memory']['usage'] / metrics['memory']['limit']) * 100, 2
                )

            # Estimate cumulative network bytes (rough approximation)
            # In a real scenario, you'd want to track this more precisely
            metrics['network']['rxBytes'] = int(metrics['network']['rxRate'] * step)
            metrics['network']['txBytes'] = int(metrics['network']['txRate'] * step)

            time_series_data.append(metrics)

        print(f"Processed {len(time_series_data)} data points for {service_name}")
        return time_series_data

    except Exception as e:
        print(f"Error fetching metrics for {service_name}: {str(e)}")
        return None

def extract_container_name(metric_labels, service_name):
    """Extract a clean container name from Prometheus metric labels"""

    # Try different label fields that might contain the container name
    for label_key in ['name', 'container_label_com_docker_compose_service', 'container_name', 'instance']:
        if label_key in metric_labels:
            name = metric_labels[label_key]
            if service_name.lower() in name.lower():
                return name

    # Fallback to the service name
    return service_name

@app.get("/api/docker/metrics/test")
def test_prometheus_connection():
    """Test endpoint to verify Prometheus connectivity"""
    try:
        # Test basic Prometheus connection
        health_response = requests.get(f"{PROMETHEUS_URL}/-/healthy", timeout=5)
        if health_response.status_code != 200:
            return jsonify({
                "status": "error",
                "message": f"Prometheus not healthy: {health_response.status_code}"
            }), 500

        # Test a simple query
        query_response = requests.get(
            f"{PROMETHEUS_URL}/api/v1/query",
            params={'query': 'up'},
            timeout=10
        )

        if query_response.status_code == 200:
            result = query_response.json()
            targets = len(result.get('data', {}).get('result', []))

            return jsonify({
                "status": "success",
                "prometheus_url": PROMETHEUS_URL,
                "prometheus_healthy": True,
                "active_targets": targets,
                "message": "Prometheus connection successful"
            }), 200
        else:
            return jsonify({
                "status": "error",
                "message": f"Prometheus query failed: {query_response.status_code}"
            }), 500

    except requests.exceptions.RequestException as e:
        return jsonify({
            "status": "error",
            "message": f"Cannot connect to Prometheus: {str(e)}",
            "prometheus_url": PROMETHEUS_URL
        }), 500

if __name__ == "__main__":
    print(f"Starting Docker Stats Service with Prometheus integration")
    print(f"Prometheus URL: {PROMETHEUS_URL}")
    app.run(host="0.0.0.0", port=3002, debug=True)
