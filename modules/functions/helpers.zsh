# produce a changelog between the given commit and head.
changelog() {
	if [ "$1" != "" ]
	then if [ "$2" = "--full" ]
		then
			git shortlog --format="* [%h] %s" $1..HEAD
		fi
		git shortlog --merges --format="* [%h] %cD %s" $1..HEAD
	fi
}

# open
open() {
	xdg-open $1
}

# Print the path exploded one item per line
exploded_path() {
	xargs -n1 -d: <<< $PATH
}