package conversion

import (
	"os/exec"
	"path/filepath"
)

// ConvertToGLB converts a 3D model file to GLB format and returns the path to the new file.
func ConvertToGLB(inputPath string) (string, error) {
	// Determine the output file path with .glb extension
	ext := filepath.Ext(inputPath)
	var outputPath string
	if ext == "" {
		outputPath = inputPath + ".glb"
	} else {
		outputPath = inputPath[:len(inputPath)-len(ext)] + ".glb"
	}
	// Run Assimp CLI to convert the file to GLB (glTF 2.0 binary), embedding textures if possible.
	cmd := exec.Command("assimp", "export", inputPath, outputPath, "-fglb2", "-embtex")
	if err := cmd.Run(); err != nil {
		return "", err
	}
	return outputPath, nil
}
