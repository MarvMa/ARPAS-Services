# Start collecting Docker stats
collect_stats() {
    while true; do
        timestamp=$(date +%s)
        stats=$(docker stats --no-stream --format "table {{.Container}}\t{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}")
        echo "[$timestamp]"
        echo "$stats"
        echo "---"
        sleep 1
    done
}

# Export stats as JSON for the API
export_stats_json() {
    docker stats --no-stream --format '{"container":"{{.Container}}","name":"{{.Name}}","cpu":"{{.CPUPerc}}","mem":"{{.MemUsage}}","net":"{{.NetIO}}"}'
}

# Main execution
case "$1" in
    "collect")
        collect_stats
        ;;
    "json")
        export_stats_json
        ;;
    *)
        echo "Usage: $0 {collect|json}"
        exit 1
        ;;
esac