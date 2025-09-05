from pathlib import Path
import pandas as pd
import numpy as np


def get_size_category(size_mb):
    """
    Returns a Category for a given size in MB
    :param size_mb:
    :return:
    """
    size_bytes = size_mb * 1_000_000
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


def analyze_benchmark_averaged(csv_paths, cache_types):
    """
    Analyzes multiple benchmark CSV files and calculates averaged unoptimized values
    """
    all_data = {}
    categories_order = ['0-100KB', '100-500KB', '500KB-1MB', '1-5MB', '5-10MB', '>10MB']

    # First, collect all data from all benchmarks
    for csv_path, cache_type in zip(csv_paths, cache_types):
        df = pd.read_csv(csv_path)
        if 'size_category' not in df.columns:
            df['size_category'] = df['file_size_mb'].apply(get_size_category)

        category_mode_stats = df.groupby(['size_category', 'mode']).agg({
            'ttfb_ms': ['mean', 'std', 'count'],
            'total_latency_ms': ['mean', 'std'],
            'file_size_mb': 'mean'
        }).round(1)

        all_data[cache_type] = {
            'df': df,
            'stats': category_mode_stats
        }

    # Calculate averaged unoptimized values across all implementations
    avg_unopt_values = {}
    for cat in categories_order:
        unopt_ttfb_values = []
        unopt_total_values = []

        for cache_type, data in all_data.items():
            if cat in data['stats'].index.get_level_values(0):
                try:
                    unopt_data = data['stats'].loc[(cat, 'unoptimized')]
                    unopt_ttfb_values.append(unopt_data['ttfb_ms']['mean'])
                    unopt_total_values.append(unopt_data['total_latency_ms']['mean'])
                except KeyError:
                    continue

        if unopt_ttfb_values:
            avg_unopt_values[cat] = {
                'ttfb': np.mean(unopt_ttfb_values),
                'total': np.mean(unopt_total_values)
            }

    # Calculate overall averaged unoptimized values
    overall_unopt_ttfb = []
    overall_unopt_total = []
    overall_weights = []

    for cache_type, data in all_data.items():
        overall_stats = data['df'].groupby('mode').agg({
            'ttfb_ms': 'mean',
            'total_latency_ms': 'mean'
        })

        if 'unoptimized' in overall_stats.index:
            file_count = data['df']['object_id'].nunique()
            overall_unopt_ttfb.append(overall_stats.loc['unoptimized', 'ttfb_ms'])
            overall_unopt_total.append(overall_stats.loc['unoptimized', 'total_latency_ms'])
            overall_weights.append(file_count)

    avg_overall_unopt = {
        'ttfb': np.average(overall_unopt_ttfb, weights=overall_weights),
        'total': np.average(overall_unopt_total, weights=overall_weights)
    }

    return all_data, avg_unopt_values, avg_overall_unopt


def generate_latex_table(all_data, avg_unopt_values, avg_overall_unopt):
    """
    Generates a LaTeX table with averaged unoptimized values
    """
    latex = []
    latex.append("\\chapter*{Tabellen}")
    latex.append("\\begin{table}[htbp]")
    latex.append("\\centering")
    latex.append("\\caption{PoC-Benchmark-Ergebnisse (mit gemittelten unoptimierten Werten)}")
    latex.append("\\label{app-tab:cache-poc-averaged}")
    latex.append("\\begin{adjustbox}{width=\\textwidth}")
    latex.append("\\begin{tabular}{@{}llrrrrrrrr@{}}")
    latex.append("\\toprule")
    latex.append(
        "\\multirow{2}{*}{Kategorie} & \\multirow{2}{*}{Implementierung} & \\multicolumn{3}{c}{TTFB (ms)} & \\multicolumn{3}{c}{Total (ms)} & \\multicolumn{2}{c}{Speedup} \\\\")
    latex.append("\\cmidrule(lr){3-5} \\cmidrule(lr){6-8} \\cmidrule(lr){9-10}")
    latex.append(
        " & & Opt. & Unopt.\\textsuperscript{*} & Diff. & Opt. & Unopt.\\textsuperscript{*} & Diff. & TTFB & Total \\\\")
    latex.append("\\midrule")

    categories_order = ['0-100KB', '100-500KB', '1-5MB', '5-10MB', '>10MB']
    cache_order = ['LRU-Cache', 'MEMORY SHARDING', 'RISTRETTO']

    # Store results for overall calculation
    all_results = {cache: [] for cache in cache_order}

    for cat_idx, cat in enumerate(categories_order):
        if cat not in avg_unopt_values:
            continue

        # Add multirow for category
        first_row = True
        for cache_type in cache_order:
            if cache_type in all_data:
                data = all_data[cache_type]
                if cat in data['stats'].index.get_level_values(0):
                    try:
                        opt_data = data['stats'].loc[(cat, 'optimized')]
                        opt_ttfb = opt_data['ttfb_ms']['mean']
                        opt_total = opt_data['total_latency_ms']['mean']

                        # Use averaged unoptimized values
                        unopt_ttfb = avg_unopt_values[cat]['ttfb']
                        unopt_total = avg_unopt_values[cat]['total']

                        ttfb_diff = unopt_ttfb - opt_ttfb
                        total_diff = unopt_total - opt_total

                        ttfb_speedup = unopt_ttfb / opt_ttfb if opt_ttfb > 0 else 1.0
                        total_speedup = unopt_total / opt_total if opt_total > 0 else 1.0

                        # Get file count
                        file_count = data['df'][data['df']['size_category'] == cat]['object_id'].nunique()

                        # Store for overall calculation
                        all_results[cache_type].append({
                            'file_count': file_count,
                            'opt_ttfb': opt_ttfb,
                            'opt_total': opt_total,
                            'ttfb_speedup': ttfb_speedup,
                            'total_speedup': total_speedup
                        })

                        # Format display name
                        display_name = "LRU-Cache" if cache_type == "LRU-Cache" else \
                            "Memory Sharding" if cache_type == "MEMORY SHARDING" else \
                                "Ristretto"

                        # Create row
                        if first_row:
                            cat_label = f"\\multirow{{3}}{{*}}{{{cat}}}"
                            first_row = False
                        else:
                            cat_label = ""

                        # Check for negative values (performance regression)
                        if ttfb_speedup < 1.0 or total_speedup < 1.0:
                            row = f" {cat_label} & {display_name} & {opt_ttfb:.1f} & {unopt_ttfb:.1f} & "
                            if ttfb_diff < 0:
                                row += f"\\textcolor{{red}}{{{ttfb_diff:.1f}}} & "
                            else:
                                row += f"{ttfb_diff:.1f} & "
                            row += f"{opt_total:.1f} & {unopt_total:.1f} & "
                            if total_diff < 0:
                                row += f"\\textcolor{{red}}{{{total_diff:.1f}}} & "
                            else:
                                row += f"{total_diff:.1f} & "
                            if ttfb_speedup < 1.0:
                                row += f"\\textcolor{{red}}{{{ttfb_speedup:.2f}×}} & "
                            else:
                                row += f"{ttfb_speedup:.2f}× & "
                            if total_speedup < 1.0:
                                row += f"\\textcolor{{red}}{{{total_speedup:.2f}×}} \\\\"
                            else:
                                row += f"{total_speedup:.2f}× \\\\"
                        else:
                            # Check for best values
                            is_best_ttfb = ttfb_speedup >= 2.3  # Threshold for highlighting
                            is_best_total = total_speedup >= 1.25  # Threshold for highlighting

                            row = f" {cat_label} & {display_name} & {opt_ttfb:.1f} & {unopt_ttfb:.1f} & {ttfb_diff:.1f} & "
                            row += f"{opt_total:.1f} & {unopt_total:.1f} & {total_diff:.1f} & "

                            if is_best_ttfb:
                                row += f"\\textbf{{{ttfb_speedup:.2f}×}} & "
                            else:
                                row += f"{ttfb_speedup:.2f}× & "

                            if is_best_total:
                                row += f"\\textbf{{{total_speedup:.2f}×}} \\\\"
                            else:
                                row += f"{total_speedup:.2f}× \\\\"

                        latex.append(row)

                    except KeyError:
                        continue

        if cat_idx < len(categories_order) - 1:
            latex.append("\\midrule")

    # Add overall results
    latex.append("\\midrule")
    latex.append("\\midrule")

    first_row = True
    for cache_type in cache_order:
        if cache_type in all_results and all_results[cache_type]:
            results = all_results[cache_type]
            total_files = sum(r['file_count'] for r in results)

            overall_opt_ttfb = sum(r['opt_ttfb'] * r['file_count'] for r in results) / total_files
            overall_opt_total = sum(r['opt_total'] * r['file_count'] for r in results) / total_files

            # Use averaged overall unoptimized values
            overall_ttfb_speedup = avg_overall_unopt['ttfb'] / overall_opt_ttfb if overall_opt_ttfb > 0 else 1.0
            overall_total_speedup = avg_overall_unopt['total'] / overall_opt_total if overall_opt_total > 0 else 1.0

            ttfb_diff = avg_overall_unopt['ttfb'] - overall_opt_ttfb
            total_diff = avg_overall_unopt['total'] - overall_opt_total

            display_name = "LRU-Cache" if cache_type == "LRU-Cache" else \
                "Memory Sharding" if cache_type == "MEMORY SHARDING" else \
                    "Ristretto"

            if first_row:
                cat_label = "\\multirow{3}{*}{\\textbf{Gesamt}}"
                first_row = False
            else:
                cat_label = ""

            row = f" {cat_label} & {display_name} & {overall_opt_ttfb:.1f} & {avg_overall_unopt['ttfb']:.1f} & "
            row += f"{ttfb_diff:.1f} & {overall_opt_total:.1f} & {avg_overall_unopt['total']:.1f} & "
            row += f"{total_diff:.1f} & {overall_ttfb_speedup:.2f}× & {overall_total_speedup:.2f}× \\\\"

            latex.append(row)

    latex.append("\\bottomrule")
    latex.append("\\end{tabular}")
    latex.append("\\end{adjustbox}")
    latex.append(
        "\\footnotesize{\\textsuperscript{*}Unoptimierte Werte sind über alle drei Cache-Implementierungen gemittelt}")
    latex.append("\\end{table}")

    return "\n".join(latex)


def generate_comparison_report(all_data, avg_unopt_values, avg_overall_unopt):
    """
    Generates a text report with averaged unoptimized values
    """
    report = []
    report.append("STORAGE SERVICE BENCHMARK RESULTS - AVERAGED COMPARISON")
    report.append("=" * 80)
    report.append("")
    report.append("NOTE: Unoptimized values are averaged across all three implementations")
    report.append("")

    categories_order = ['0-100KB', '100-500KB', '1-5MB', '5-10MB', '>10MB']
    cache_order = ['LRU-Cache', 'MEMORY SHARDING', 'RISTRETTO']

    for cat in categories_order:
        if cat not in avg_unopt_values:
            continue

        report.append(f"\nCATEGORY: {cat}")
        report.append("-" * 40)
        report.append(f"Averaged Unoptimized TTFB: {avg_unopt_values[cat]['ttfb']:.1f}ms")
        report.append(f"Averaged Unoptimized Total: {avg_unopt_values[cat]['total']:.1f}ms")
        report.append("")
        report.append(
            f"{'Implementation':<20} {'Opt TTFB':<12} {'Speedup TTFB':<12} {'Opt Total':<12} {'Speedup Total':<12}")
        report.append("-" * 68)

        for cache_type in cache_order:
            if cache_type in all_data:
                data = all_data[cache_type]
                if cat in data['stats'].index.get_level_values(0):
                    try:
                        opt_data = data['stats'].loc[(cat, 'optimized')]
                        opt_ttfb = opt_data['ttfb_ms']['mean']
                        opt_total = opt_data['total_latency_ms']['mean']

                        ttfb_speedup = avg_unopt_values[cat]['ttfb'] / opt_ttfb if opt_ttfb > 0 else 1.0
                        total_speedup = avg_unopt_values[cat]['total'] / opt_total if opt_total > 0 else 1.0

                        display_name = cache_type.replace("MEMORY SHARDING", "Memory Sharding")
                        display_name = display_name.replace("RISTRETTO", "Ristretto")

                        report.append(
                            f"{display_name:<20} {opt_ttfb:<12.1f} {ttfb_speedup:<12.2f}x {opt_total:<12.1f} {total_speedup:<12.2f}x")
                    except KeyError:
                        continue

    report.append("\n" + "=" * 80)
    report.append("OVERALL RESULTS (with averaged unoptimized baseline)")
    report.append("-" * 40)
    report.append(f"Averaged Unoptimized TTFB: {avg_overall_unopt['ttfb']:.1f}ms")
    report.append(f"Averaged Unoptimized Total: {avg_overall_unopt['total']:.1f}ms")
    report.append("")

    for cache_type in cache_order:
        if cache_type in all_data:
            overall_stats = all_data[cache_type]['df'].groupby('mode').agg({
                'ttfb_ms': 'mean',
                'total_latency_ms': 'mean'
            })

            if 'optimized' in overall_stats.index:
                opt_ttfb = overall_stats.loc['optimized', 'ttfb_ms']
                opt_total = overall_stats.loc['optimized', 'total_latency_ms']

                ttfb_speedup = avg_overall_unopt['ttfb'] / opt_ttfb
                total_speedup = avg_overall_unopt['total'] / opt_total

                display_name = cache_type.replace("MEMORY SHARDING", "Memory Sharding")
                display_name = display_name.replace("RISTRETTO", "Ristretto")

                report.append(
                    f"{display_name}: TTFB Speedup = {ttfb_speedup:.2f}x, Total Speedup = {total_speedup:.2f}x")

    return "\n".join(report)


def main():
    base_path = Path("benchmark_results")

    benchmarks = [
        {
            'cache_type': 'LRU-Cache',
            'folder': 'lru-cache',
            'subfolder': 'simple-bench',
            'csv_file': 'benchmark_results_20250903_133308_LRU.csv'
        },
        {
            'cache_type': 'MEMORY SHARDING',
            'folder': 'memory-sharding',
            'subfolder': 'simple-bench',
            'csv_file': 'benchmark_results_20250902_205105_SHARDING.csv'
        },
        {
            'cache_type': 'RISTRETTO',
            'folder': 'ristretto',
            'subfolder': 'simple-bench',
            'csv_file': 'benchmark_results_20250903_134126_RISTRETTO.csv'
        }
    ]

    # Collect all CSV paths and cache types
    csv_paths = []
    cache_types = []

    for benchmark in benchmarks:
        csv_path = base_path / benchmark['folder'] / benchmark['subfolder'] / benchmark['csv_file']
        if csv_path.exists():
            csv_paths.append(csv_path)
            cache_types.append(benchmark['cache_type'])
            print(f"Found file for {benchmark['cache_type']}: {csv_path}")
        else:
            print(f"ERROR: File not found: {csv_path}")
            return

    # Analyze with averaged unoptimized values
    print("\nAnalyzing benchmarks with averaged unoptimized values...")
    all_data, avg_unopt_values, avg_overall_unopt = analyze_benchmark_averaged(csv_paths, cache_types)

    # Generate LaTeX table
    latex_table = generate_latex_table(all_data, avg_unopt_values, avg_overall_unopt)
    latex_output = base_path / "benchmark_results_averaged_latex.tex"

    with open(latex_output, 'w', encoding='utf-8') as f:
        f.write(latex_table)

    print(f"\nLaTeX table saved to: {latex_output}")

    # Generate comparison report
    comparison_report = generate_comparison_report(all_data, avg_unopt_values, avg_overall_unopt)
    report_output = base_path / "benchmark_results_averaged_comparison.txt"

    with open(report_output, 'w', encoding='utf-8') as f:
        f.write(comparison_report)

    print(f"Comparison report saved to: {report_output}")

    # Print summary
    print("\n" + "=" * 80)
    print("SUMMARY OF AVERAGED RESULTS")
    print("-" * 40)
    print(f"Overall Averaged Unoptimized TTFB: {avg_overall_unopt['ttfb']:.1f}ms")
    print(f"Overall Averaged Unoptimized Total: {avg_overall_unopt['total']:.1f}ms")
    print("\nNew Speedup Values (using averaged baseline):")

    for cache_type in cache_types:
        overall_stats = all_data[cache_type]['df'].groupby('mode').agg({
            'ttfb_ms': 'mean',
            'total_latency_ms': 'mean'
        })

        if 'optimized' in overall_stats.index:
            opt_ttfb = overall_stats.loc['optimized', 'ttfb_ms']
            opt_total = overall_stats.loc['optimized', 'total_latency_ms']

            ttfb_speedup = avg_overall_unopt['ttfb'] / opt_ttfb
            total_speedup = avg_overall_unopt['total'] / opt_total

            display_name = cache_type.replace("MEMORY SHARDING", "Memory Sharding").replace("RISTRETTO", "Ristretto")
            print(f"  {display_name:<20}: TTFB {ttfb_speedup:.2f}x, Total {total_speedup:.2f}x")


if __name__ == "__main__":
    main()