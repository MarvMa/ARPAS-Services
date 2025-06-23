package extraction

import (
	"golang.org/x/net/context"
	"io"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/mholt/archives"
)

// ExtractArchive extracts the contents of a ZIP or RAR archive to a temporary directory.
func ExtractArchive(archivePath string) ([]string, string, error) {
	destDir, err := os.MkdirTemp("", "extract-*")
	if err != nil {
		return nil, "", err
	}

	ctx := context.Background()
	fsys, err := archives.FileSystem(ctx, archivePath, nil)
	if err != nil {
		os.RemoveAll(destDir)
		return nil, "", err
	}

	var files []string
	err = fs.WalkDir(fsys, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		reader, err := fsys.Open(path)
		if err != nil {
			return err
		}
		defer reader.Close()

		destPath := filepath.Join(destDir, path)
		if err := os.MkdirAll(filepath.Dir(destPath), 0o755); err != nil {
			return err
		}

		outFile, err := os.Create(destPath)
		if err != nil {
			return err
		}
		defer outFile.Close()

		if _, err := io.Copy(outFile, reader); err != nil {
			return err
		}

		files = append(files, destPath)
		return nil
	})
	if err != nil {
		os.RemoveAll(destDir)
		return nil, "", err
	}

	return files, destDir, nil
}
