WEIGHT_FILE="$HOME/weight.dat"

_w_bold()  { printf "\033[1m%s\033[0m" "$*"; }
_w_dim()   { printf "\033[2m%s\033[0m" "$*"; }
_w_cyan()  { printf "\033[1;36m%s\033[0m" "$*"; }
_w_green() { printf "\033[1;32m%s\033[0m" "$*"; }
_w_yellow(){ printf "\033[33m%s\033[0m" "$*"; }

_w_row() { printf "  %s  %s\n" "$(_w_dim "$1")" "$2"; }

_w_spark() {
    awk '/^[^#]/{v[++n]=$2} END{
        if(n<2){exit}
        min=max=v[1]
        for(i=2;i<=n;i++){if(v[i]<min)min=v[i]; if(v[i]>max)max=v[i]}
        split("▁▂▃▄▅▆▇█",b,"")
        range=max-min
        for(i=1;i<=n;i++){
            if(range==0){idx=1}else{idx=int((v[i]-min)/range*7)+1}
            printf "%s",b[idx]
        }
        print ""
    }' "$WEIGHT_FILE"
}

wa() {
    if [[ -z "$1" ]]; then
        echo "Usage: wa <weight_kg>"
        return 1
    fi
    echo "$(date +%Y-%m-%d)   $1" >> "$WEIGHT_FILE"
    local first=$(awk '/^[^#]/{print $2; exit}' "$WEIGHT_FILE")
    local lost=$(echo "$first - $1" | bc)
    printf "%s %s  %s  %s  %s  %s\n" \
        "$(_w_green "✓")" "$(_w_bold "$1 kg")" "$(_w_dim "·")" "$(date +%b\ %d)" "$(_w_dim "·")" "$(_w_cyan "-${lost} kg")"
}

ws() {
    if [[ ! -f "$WEIGHT_FILE" ]]; then
        echo "No data yet. Use: wa <weight_kg>"
        return 1
    fi
    local first=$(awk '/^[^#]/{print $2; exit}' "$WEIGHT_FILE")
    local first_date=$(awk '/^[^#]/{print $1; exit}' "$WEIGHT_FILE")
    local last=$(awk '/^[^#]/{v=$2} END{print v}' "$WEIGHT_FILE")
    local last_date=$(awk '/^[^#]/{d=$1} END{print d}' "$WEIGHT_FILE")
    local lost=$(echo "$first - $last" | bc)
    local count=$(awk '/^[^#]/{n++} END{print n}' "$WEIGHT_FILE")
    local spark=$(_w_spark)

    printf "\n"
    _w_row "Start" "$(_w_bold "$first kg")  $(_w_dim "$first_date")"
    _w_row "Now  " "$(_w_bold "$last kg")  $(_w_dim "$last_date")"
    _w_row "Lost " "$(_w_cyan "-${lost} kg")  $(_w_dim "($count entries)")"
    [[ -n "$spark" ]] && _w_row "Trend" "$(_w_yellow "$spark")"
    printf "\n"
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
set terminal dumb size 80,24 ansi256
set xdata time
set timefmt '%Y-%m-%d'
set format x '%m/%d'
set ylabel 'kg'
set title 'Weight Loss'
set style line 1 linecolor rgb "cyan"
plot "$WEIGHT_FILE" using 1:2 with linespoints linestyle 1 notitle
PLOT
            local n="${1:-10}"
            awk -v n="$n" '/^[^#]/{d[++c]=$1; w[c]=$2} END{
                s=(c>n)?c-n+1:1
                printf "%s\t%s\t\n", d[1], w[1]
                if(s<=1) s=2
                if(s>1 && s<=c) printf "...\t\t\n"
                for(i=s;i<=c;i++){
                    printf "%s\t%s\t%.2f\n", d[i], w[i], w[i]-w[i-1]
                }
            }' "$WEIGHT_FILE" | while IFS=$'\t' read -r d w delta; do
                if [[ "$d" == "..." ]]; then
                    printf "  $(_w_dim "···")\n"
                    continue
                fi
                local arrow=""
                if [[ -z "$delta" ]]; then
                    arrow=$(_w_dim "—")
                elif [[ "$delta" == -* ]]; then
                    arrow=$(_w_green "↓${delta}")
                elif [[ "$delta" != "0.00" ]]; then
                    arrow=$(_w_cyan "↑+${delta}")
                else
                    arrow=$(_w_dim "—")
                fi
                _w_row "$d" "$(_w_bold "${w} kg")  ${arrow}"
            done
            printf "\n"
            ;;
    esac
}
