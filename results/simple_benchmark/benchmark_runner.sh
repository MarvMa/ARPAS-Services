#!/bin/bash

# Storage Service Benchmark Runner
# Automated script to run complete benchmark suite

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
STORAGE_URL="http://localhost:8000"
BENCHMARK_DIR="benchmark_results"
LOG_FILE="benchmark_run.log"

# Functions
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE"
    exit 1
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1" | tee -a "$LOG_FILE"
}

check_service() {
    log "Checking storage service availability..."
    if curl -s -f -o /dev/null "$STORAGE_URL/health"; then
        log "Storage service is running ✓"
    else
        error "Storage service is not accessible at $STORAGE_URL"
    fi
}

check_objects() {
    log "Checking for existing objects..."
    response=$(curl -s "$STORAGE_URL/api/storage/objects")
    count=$(echo "$response" | python3 -c "import sys, json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

    if [ "$count" -eq "0" ]; then
        warning "No objects found in storage service"
        echo "Would you like to upload a test object? (y/n)"
        read -r answer
        if [ "$answer" = "y" ]; then
            upload_test_object
        else
            error "Cannot run benchmark without objects"
        fi
    else
        log "Found $count objects in storage ✓"
    fi
}

upload_test_object() {
    log "Creating test GLB file..."

    # Create a minimal GLB file (empty scene)
    # This is a minimal valid GLB 2.0 file structure
    echo -ne '\x67\x6C\x54\x46\x02\x00\x00\x00\x74\x00\x00\x00\x58\x00\x00\x00\x4A\x53\x4F\x4E\x7B\x22\x61\x73\x73\x65\x74\x22\x3A\x7B\x22\x76\x65\x72\x73\x69\x6F\x6E\x22\x3A\x22\x32\x2E\x30\x22\x7D\x2C\x22\x73\x63\x65\x6E\x65\x22\x3A\x30\x2C\x22\x73\x63\x65\x6E\x65\x73\x22\x3A\x5B\x7B\x22\x6E\x6F\x64\x65\x73\x22\x3A\x5B\x30\x5D\x7D\x5D\x2C\x22\x6E\x6F\x64\x65\x73\x22\x3A\x5B\x7B\x7D\x5D\x7D\x00\x00\x00\x00' > test.glb

    log "Uploading test object..."
    response=$(curl -s -X POST \
        -F "file=@test.glb" \
        -F "latitude=52.5200" \
        -F "longitude=13.4050" \
        -F "altitude=100.0" \
        "$STORAGE_URL/api/storage/objects/upload")

    if echo "$response" | grep -q "ID"; then
        log "Test object uploaded successfully ✓"
        rm test.glb
    else
        error "Failed to upload test object: $response"
    fi
}

install_dependencies() {
    log "Checking Python dependencies..."

    if ! python3 -c "import requests, pandas, matplotlib, seaborn, scipy, numpy" 2>/dev/null; then
        log "Installing required Python packages..."
        pip3 install -q requests pandas matplotlib seaborn scipy numpy openpyxl
    else
        log "All Python dependencies installed ✓"
    fi
}

run_quick_benchmark() {
    log "Running quick benchmark (50 requests)..."
    python3 quick_benchmark.py
}

run_full_benchmark() {
    log "Running full scientific benchmark (100 requests)..."
    python3 benchmark.py
}

clear_cache() {
    log "Clearing cache..."
    curl -s -X POST "$STORAGE_URL/cache/clear" > /dev/null
    log "Cache cleared ✓"
}

generate_summary() {
    log "Generating summary report..."

    # Find the latest benchmark result
    latest_csv=$(ls -t "$BENCHMARK_DIR"/benchmark_raw_*.csv 2>/dev/null | head -1)

    if [ -z "$latest_csv" ]; then
        warning "No benchmark results found"
        return
    fi

    # Generate summary using Python
    python3 - <<EOF
import pandas as pd
import sys

df = pd.read_csv('$latest_csv')
df_opt = df[df['mode'] == 'optimized']
df_unopt = df[df['mode'] == 'unoptimized']

print("\n" + "="*60)
print("BENCHMARK SUMMARY")
print("="*60)
print(f"\nOptimized Mode:")
print(f"  Mean TTFB: {df_opt['ttfb'].mean():.2f} ms")
print(f"  P95 TTFB: {df_opt['ttfb'].quantile(0.95):.2f} ms")
print(f"  Cache Hits: {df_opt['cache_hit'].sum()}/{len(df_opt)}")

print(f"\nUnoptimized Mode:")
print(f"  Mean TTFB: {df_unopt['ttfb'].mean():.2f} ms")
print(f"  P95 TTFB: {df_unopt['ttfb'].quantile(0.95):.2f} ms")

improvement = ((df_unopt['ttfb'].mean() - df_opt['ttfb'].mean()) / df_unopt['ttfb'].mean() * 100)
print(f"\nPerformance Improvement: {improvement:.1f}%")
print("="*60)
EOF
}

show_menu() {
    echo ""
    echo "Storage Service Benchmark Suite"
    echo "================================"
    echo "1. Run quick benchmark (1-2 minutes)"
    echo "2. Run full scientific benchmark (5-10 minutes)"
    echo "3. Run both benchmarks"
    echo "4. Clear cache"
    echo "5. Check service status"
    echo "6. Upload test object"
    echo "7. Exit"
    echo ""
    echo -n "Select option: "
}

# Main execution
main() {
    log "Starting Storage Service Benchmark Suite"

    # Initial checks
    check_service
    install_dependencies
    check_objects

    # Create results directory
    mkdir -p "$BENCHMARK_DIR"

    # Interactive menu
    while true; do
        show_menu
        read -r option

        case $option in
            1)
                clear_cache
                run_quick_benchmark
                ;;
            2)
                clear_cache
                run_full_benchmark
                generate_summary
                ;;
            3)
                clear_cache
                run_quick_benchmark
                clear_cache
                run_full_benchmark
                generate_summary
                ;;
            4)
                clear_cache
                ;;
            5)
                check_service
                check_objects
                ;;
            6)
                upload_test_object
                ;;
            7)
                log "Exiting benchmark suite"
                exit 0
                ;;
            *)
                warning "Invalid option"
                ;;
        esac
    done
}

# Run main function
main "$@"