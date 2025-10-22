# go itself
export GOPATH=$HOME/go
# export PATH=$PATH:/usr/local/go/bin
# export PATH=$PATH:$GOPATH/bin
export GOPRIVATE=github.com/go-flexible/*,github.com/lootlocker/*

# only check if go is installed once we have it in the path.
warn_is_installed go

# mage
export MAGEFILE_ENABLE_COLOR=1
export MAGEFILE_TARGET_COLOR=BrightCyan

# linter settings
if warn_is_installed golangci-lint; then
	alias lint="golangci-lint run -E=revive -E=ifshort -E=gocritic -E=dogsled -E=gosec -E=misspell -E=goconst -E=sqlclosecheck -E=rowserrcheck -E=goconst -E=noctx"
fi
