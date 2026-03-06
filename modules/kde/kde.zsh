local dir=$(dirname $0)

if [ ! -f ~/.local/bin/ulid-convert.sh ]; then
    mkdir -p ~/.local/bin
    cp -R "$dir"/ulid-convert.sh ~/.local/bin/
fi
