from flask import Flask, jsonify
import docker

app = Flask(__name__)
client = docker.from_env()


@app.get("/health")
def health():
    return jsonify({"status": "ok"}), 200


@app.get("/api/docker/stats")
def docker_stats():
    stats_list = []
    for c in client.containers.list(all=True):
        try:
            s = c.stats(stream=False)
            # CPU-Berechnung nach Docker-Logik
            cpu_delta = s["cpu_stats"]["cpu_usage"]["total_usage"] - s["precpu_stats"]["cpu_usage"]["total_usage"]
            system_delta = s["cpu_stats"]["system_cpu_usage"] - s["precpu_stats"]["system_cpu_usage"]
            cpu_pct = 0.0
            if system_delta > 0 and cpu_delta >= 0:
                online_cpus = s["cpu_stats"].get("online_cpus") or len(
                    s["cpu_stats"]["cpu_usage"].get("percpu_usage", [])) or 1
                cpu_pct = (cpu_delta / system_delta) * online_cpus * 100.0

            mem_usage = s["memory_stats"].get("usage", 0)
            mem_limit = s["memory_stats"].get("limit", 0)
            mem_pct = (mem_usage / mem_limit * 100.0) if mem_limit else 0.0

            rx_bytes = s["networks"][next(iter(s["networks"]))]["rx_bytes"] if s.get("networks") else 0
            tx_bytes = s["networks"][next(iter(s["networks"]))]["tx_bytes"] if s.get("networks") else 0

            blkio = s.get("blkio_stats", {}).get("io_service_bytes_recursive", [])
            r_bytes = sum(x.get("value", 0) for x in blkio if x.get("op") == "Read")
            w_bytes = sum(x.get("value", 0) for x in blkio if x.get("op") == "Write")

            stats_list.append({
                "id": c.id[:12],
                "name": c.name,
                "state": c.status,
                "cpu_percent": round(cpu_pct, 2),
                "mem_usage": mem_usage,
                "mem_limit": mem_limit,
                "mem_percent": round(mem_pct, 2),
                "net_rx_bytes": rx_bytes,
                "net_tx_bytes": tx_bytes,
                "block_read_bytes": r_bytes,
                "block_write_bytes": w_bytes
            })
        except Exception as e:
            stats_list.append({"id": c.id[:12], "name": c.name, "error": str(e)})

    return jsonify({"containers": stats_list}), 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3002)
