package conversion

import (
	"io"
	"os"
	"path/filepath"
)

// ConvertToGLB converts a 3D model file to GLB format.
// It returns the file path of the converted .glb file.
func ConvertToGLB(inputPath string) (string, error) {
	// Determine output path by replacing/extending extension to .glb
	outputPath := inputPath + ".glb"
	if filepath.Ext(inputPath) != "" {
		outputPath = inputPath[0:len(inputPath)-len(filepath.Ext(inputPath))] + ".glb"
	}
	// In a real implementation, call a conversion library or external tool here.
	// For demonstration, we simply copy the input file to the output path.
	inFile, err := os.Open(inputPath)
	if err != nil {
		return "", err
	}
	defer inFile.Close()
	outFile, err := os.Create(outputPath)
	if err != nil {
		return "", err
	}
	defer outFile.Close()
	_, err = io.Copy(outFile, inFile)
	if err != nil {
		return "", err
	}
	return outputPath, nil
}
