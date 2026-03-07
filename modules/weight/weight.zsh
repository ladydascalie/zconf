WEIGHT_FILE="$HOME/weight.dat"

wa() {
    if [[ -z "$1" ]]; then
        echo "Usage: wa <weight_kg>"
        return 1
    fi
    echo "$(date +%Y-%m-%d)   $1" >> "$WEIGHT_FILE"
    local first=$(awk '/^[^#]/{print $2; exit}' "$WEIGHT_FILE")
    local lost=$(echo "$first - $1" | bc)
    echo "Logged: $(date +%Y-%m-%d) $1 kg (total: -${lost} kg)"
}

ws() {
    if [[ ! -f "$WEIGHT_FILE" ]]; then
        echo "No data yet. Use: wa <weight_kg>"
        return 1
    fi
    local first=$(awk '/^[^#]/{print $2; exit}' "$WEIGHT_FILE")
    local last=$(awk '/^[^#]/{v=$2} END{print v}' "$WEIGHT_FILE")
    local lost=$(echo "$first - $last" | bc)
    echo "Start: $first kg | Now: $last kg | Lost: $lost kg"
}

wp() {
    if [[ ! -f "$WEIGHT_FILE" ]]; then
        echo "No data yet. Use: wa <weight_kg>"
        return 1
    fi

    local mode="${1:-term}"
    case "$mode" in
        png)
            gnuplot <<PLOT
set terminal png size 800,400 font "sans,12"
set output "$HOME/weight.png"
set xdata time
set timefmt '%Y-%m-%d'
set format x '%m/%d'
set ylabel 'kg'
set title 'Weight Loss'
set grid
plot "$WEIGHT_FILE" using 1:2 with linespoints pointtype 7 linewidth 2 notitle
PLOT
            echo "Saved ~/weight.png"
            ;;
        *)
            gnuplot <<PLOT
set terminal dumb size 80,24
set xdata time
set timefmt '%Y-%m-%d'
set format x '%m/%d'
set ylabel 'kg'
set title 'Weight Loss'
plot "$WEIGHT_FILE" using 1:2 with linespoints notitle
PLOT
            ;;
    esac
}
