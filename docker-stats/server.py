from flask import Flask, jsonify, request
import docker
import os, time, threading, uuid, requests

PROM_BASE = os.getenv("PROMETHEUS_BASE_URL", "http://prometheus:9090")
HTTP_TIMEOUT = float(os.getenv("PROM_HTTP_TIMEOUT", "8"))

JOBS = {}  # jobId -> {"status": "pending"|"done"|"error", "result": {...}, "error": str}
JOBS_LOCK = threading.Lock()

app = Flask(__name__)
client = docker.from_env()


@app.get("/health")
def health():
    return jsonify({"status": "ok"}), 200

@app.post("/api/docker/sim-summary")
def start_sim_summary():
    """
    Body: { simId: str, groups: [str], startTs: ISO, endTs: ISO }
    """
    data = request.get_json(force=True, silent=True) or {}
    for k in ("simId", "groups", "startTs", "endTs"):
        if k not in data:
            return jsonify({"error": f"missing field: {k}"}), 400
    job_id = str(uuid.uuid4())
    with JOBS_LOCK:
        JOBS[job_id] = {"status": "pending"}
    t = threading.Thread(target=_run_summary_job, args=(job_id, data), daemon=True)
    t.start()
    return jsonify({"jobId": job_id}), 202


@app.get("/api/docker/sim-summary/<job_id>")
def get_sim_summary(job_id: str):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if not job:
        return jsonify({"status": "error", "error": "job not found"}), 404
    if job.get("status") == "done":
        return jsonify({"status": "done", "result": job.get("result")}), 200
    if job.get("status") == "error":
        return jsonify({"status": "error", "error": job.get("error")}), 200
    return jsonify({"status": "pending"}), 200

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


# -------------------- Prometheus helpers --------------------
def _prom_instant(query: str, ts_iso: str):
    try:
        r = requests.get(f"{PROM_BASE}/api/v1/query",
                         params={"query": query, "time": ts_iso},
                         timeout=HTTP_TIMEOUT,
                         )
        r.raise_for_status()
        data = r.json()
        if data.get("status") != "success":
           raise RuntimeError(f"Prom error: {data}")
        return data["data"]["result"]
    except Exception as e:
        raise RuntimeError(f"Prometheus request failed for {query}: {e}")


def _num(v) -> float:
    try:
        return float(v)
    except Exception as _e:
        return 0.0


def _iso_to_epoch(iso_ts: str) -> float:
    return time.mktime(time.strptime(iso_ts.split('.')[0], "%Y-%m-%dT%H:%M:%S"))

def compute_group_rollup(group: str, start_ts: str, end_ts: str):
    start_epoch = _iso_to_epoch(start_ts)
    end_epoch = _iso_to_epoch(end_ts)
    dur_s = max(1, int(end_epoch - start_epoch))
    dur = f"{dur_s}s"
    end_iso = end_ts 

    q_cpu = f'sum by (sim.group) (increase(container_cpu_usage_seconds_total{{sim.group="{group}"}}[{dur}]))'
    q_mem = f'max_over_time(container_memory_working_set_bytes{{sim.group="{group}"}}[{dur}])'
    q_rx  = f'sum(increase(container_network_receive_bytes_total{{sim.group="{group}"}}[{dur}]))'
    q_tx  = f'sum(increase(container_network_transmit_bytes_total{{sim.group="{group}"}}[{dur}]))'
    q_io  = f'sum(increase(container_fs_reads_bytes_total{{sim.group="{group}"}}[{dur}])) + sum(increase(container_fs_writes_bytes_total{{sim.group="{group}"}}[{dur}]))'

    cpu_res = _prom_instant(q_cpu, end_iso)
    mem_res = _prom_instant(q_mem, end_iso)
    rx_res  = _prom_instant(q_rx,  end_iso)
    tx_res  = _prom_instant(q_tx,  end_iso)
    
    try:
        io_res = _prom_instant(q_io, end_iso)
    except Exception:
        io_res = []

    def _first_value(res):
        if not res:
            return 0.0
        return _num(res[0]["value"][1])

    cpu_seconds = _first_value(cpu_res)
    mem_peak    = _first_value(mem_res)
    net_bytes   = _first_value(rx_res) + _first_value(tx_res)
    io_bytes    = _first_value(io_res) if io_res else 0.0

    per_containers = []
    for label in ("name", "container"):
        try:
            qc_cpu = f'sum by ({label}) (increase(container_cpu_usage_seconds_total{{sim.group="{group}"}}[{dur}]))'
            qc_mem = f'max_over_time(container_memory_working_set_bytes{{sim.group="{group}"}}[{dur}])'
            qc_rx  = f'sum by ({label}) (increase(container_network_receive_bytes_total{{sim.group="{group}"}}[{dur}]))'
            qc_tx  = f'sum by ({label}) (increase(container_network_transmit_bytes_total{{sim.group="{group}"}}[{dur}]))'
            rcpu = _prom_instant(qc_cpu, end_iso)
            rmem = _prom_instant(qc_mem, end_iso)
            rrx  = _prom_instant(qc_rx,  end_iso)
            rtx  = _prom_instant(qc_tx,  end_iso)

            def idx(res):
                out = {}
                for s in res:
                    key = s["metric"].get(label) or s["metric"].get("container") or s["metric"].get("name")
                    if key:
                        out[key] = _num(s["value"][1])
                return out
            m_cpu = idx(rcpu)
            m_mem = idx(rmem)
            m_rx  = idx(rrx)
            m_tx  = idx(rtx)
            keys = set(m_cpu) | set(m_mem) | set(m_rx) | set(m_tx)
            if keys:
                per_containers = [{
                    "name": k,
                    "cpuSeconds": _num(m_cpu.get(k, 0.0)),
                    "memPeakBytes": _num(m_mem.get(k, 0.0)),
                    "netBytes": _num(m_rx.get(k, 0.0)) + _num(m_tx.get(k, 0.0))
                } for k in sorted(keys)]
                break
        except Exception:
            continue

    return {
        "cpuSeconds": cpu_seconds,
        "memPeakBytes": mem_peak,
        "netBytes": net_bytes,
        "ioBytes": io_bytes,
        "containers": per_containers
    }

# -------------------- Job API --------------------
def _run_summary_job(job_id: str, payload: dict):
    try:
        sim_id = payload["simId"]
        groups = payload["groups"]
        start_ts = payload["startTs"]
        end_ts = payload["endTs"]

        per_group = {}
        totals = {"cpuSeconds": 0.0, "memPeakBytes": 0.0, "netBytes": 0.0, "ioBytes": 0.0}

        for g in groups:
            roll = compute_group_rollup(g, start_ts, end_ts)
            per_group[g] = roll
            totals["cpuSeconds"] += roll["cpuSeconds"]
            totals["netBytes"]   += roll["netBytes"]
            totals["ioBytes"]    += roll.get("ioBytes", 0.0)
            totals["memPeakBytes"] = max(totals["memPeakBytes"], roll["memPeakBytes"])  # Peak als Max über Gruppen

        result = {
            "simId": sim_id,
            "window": {"start": start_ts, "end": end_ts},
            "perGroup": per_group,
            "totals": totals
        }
        with JOBS_LOCK:
            JOBS[job_id]["status"] = "done"
            JOBS[job_id]["result"] = result
    except Exception as e:
        with JOBS_LOCK:
            JOBS[job_id]["status"] = "error"
            JOBS[job_id]["error"] = str(e)




if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3002)
