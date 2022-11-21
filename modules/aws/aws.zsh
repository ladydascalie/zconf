export AWS_PROFILE=admin@lootlocker-dev

function setup_eks_profile() {
	for tool in kubectl aws jq; do
	if ! command -v $tool &> /dev/null; then
		echo "⛔️ $tool not installed"; exit
	fi
	done

	echo "👤 Select AWS profile to use"
	profiles=($(aws configure list-profiles))
	select profile in $profiles; do
	if [[ -z $profile ]]
	then echo "AWS profile not found"
	else
		AWS_PROFILE=${profile}
		break
	fi
	done

	echo "🌐 Select AWS region"
	regions=($(aws ec2 describe-regions --profile $AWS_PROFILE --all-regions | jq -r '.Regions[] | select(.OptInStatus != "not-opted-in") | .RegionName'))
	select region in $regions; do
	if [[ -z $region ]]
	then echo "AWS region not found"
	else
		AWS_REGION=${region}
		break
	fi
	done

	echo "📦 Select EKS cluster"
	clusters=($(aws eks list-clusters --profile $AWS_PROFILE --region $AWS_REGION | jq -r '.clusters[]'))
	select cluster in $clusters; do
	if [[ -z $cluster ]]
	then echo "EKS cluster not found"
	else
		EKS_CLUSTER_NAME=${cluster}
		break
	fi
	done

	description=($(aws eks describe-cluster --profile "${AWS_PROFILE}" --region "${AWS_REGION}" --name "${EKS_CLUSTER_NAME}" | jq -r '.cluster | .endpoint,.certificateAuthority.data'))

	aws iam list-account-aliases --profile "${AWS_PROFILE}" --region ${AWS_REGION} | jq -r '.AccountAliases[0]' | read -r AWS_ACCOUNT_ALIAS
	echo $AWS_ACCOUNT_ALIAS | sed 's/-/\n/g' | tail -n 1 | read -r SERVER_PREFIX
	echo $AWS_PROFILE | sed 's/@/\n/g' | head -n 1 | read -r ROLE_PREFIX

	KUBE_SERVER_NAME="${SERVER_PREFIX}.${AWS_REGION}"
	KUBE_SERVER_ENDPOINT=$description[1]
	KUBE_SERVER_CA=$description[2]
	KUBE_USER_NAME="${ROLE_PREFIX}@${KUBE_SERVER_NAME}"

	echo "\n"
	echo "👤 AWS Profile:\t $AWS_PROFILE"
	echo "💼 AWS Account:\t $AWS_ACCOUNT_ALIAS"
	echo "🌐 AWS Region:\t $AWS_REGION"
	echo "📦 EKS Cluster:\t $EKS_CLUSTER_NAME"
	echo "\n"
	echo "👤 User:\t $KUBE_USER_NAME"
	echo "\n"
	echo "📇 Server:\t $KUBE_SERVER_NAME"
	echo "🔗 Endpoint:\t $KUBE_SERVER_ENDPOINT"
	echo "🔑 CA:\t\t $KUBE_SERVER_CA"
	echo "\n"

	echo "Press any key to continue..."
	read -rs -k

	CERT_PATH="${HOME}/.kube/certs/${KUBE_SERVER_NAME}.crt"

	mkdir -p ~/.kube/certs
	echo $KUBE_SERVER_CA | base64 -d > $CERT_PATH

	kubectl config set-cluster "${KUBE_SERVER_NAME}" \
	--server="${KUBE_SERVER_ENDPOINT}" \
	--embed-certs \
	--certificate-authority="${CERT_PATH}"

	kubectl config set-credentials "${KUBE_USER_NAME}" \
	--exec-command=aws \
	--exec-api-version="client.authentication.k8s.io/v1beta1" \
	--exec-arg="--region" \
	--exec-arg="eu-central-1" \
	--exec-arg="eks" \
	--exec-arg="get-token" \
	--exec-arg="--cluster-name" \
	--exec-arg="${EKS_CLUSTER_NAME}" \
	--exec-env="AWS_PROFILE=${AWS_PROFILE}"

	kubectl config set-context "${KUBE_USER_NAME}" \
	--user="${KUBE_USER_NAME}" \
	--cluster="${KUBE_SERVER_NAME}"

	kubectl config use-context "${KUBE_USER_NAME}"
}

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

# Select an AWS profile and sign in to it
function aws-login() {
    if ! command -v aws &> /dev/null; then
        echo "⛔️ aws cli not installed"; return 1
    fi
    aws-profile $@
    aws sso login --profile $AWS_PROFILE
}