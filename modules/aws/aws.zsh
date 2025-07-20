local dir=$(dirname $0)
local template=$dir/env.tpl
local destination_file=$dir/env.zsh

# check file exists
if [ -f $destination_file ]; then
	# all good, do nothing.
	_dbg "module(aws) ~> $destination_file already exists, nothing to do."
else
	op inject -i $template -o $destination_file
	_dbg "module(aws) ~> injecting $template to $destination_file using 1password cli"
fi

# Select an AWS profile
function aws-profile() {
    if ! command -v aws &> /dev/null; then
        echo "⛔️ aws cli not installed"; return 1
    fi
    profiles=($(aws configure list-profiles))
    if [[ $# -eq 0 ]]; then
        echo "Available profiles:"
        select profile in $profiles; do
            if [[ -z $profile ]]
            then echo "AWS profile not found"
            else
                export AWS_PROFILE=$profile
                break
            fi
        done
    else
        export AWS_PROFILE=$1
    fi
    echo "Using AWS profile $AWS_PROFILE"
}
