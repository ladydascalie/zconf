function spectrogram() {
	readonly spectrogram_file=${1:?"Usage: spectrogram <file>"}
	ffplay -f lavfi 'amovie='$spectrogram_file', asplit [a][out1];
             [a] showspectrum=mode=combined:color=channel:slide=replace:scale=lin:fscale=lin:size=1600x1024 [out0]'
}