package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"fmt"
	"io"

	"golang.org/x/crypto/argon2"
)

const (
	saltLen    = 16
	keyLen     = 32 // AES-256
	argonTime  = 1
	argonMem   = 64 * 1024
	argonParal = 4
)

func GenerateSalt() []byte {
	salt := make([]byte, saltLen)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		panic("crypto/rand: " + err.Error())
	}
	return salt
}

func DeriveKey(password string, salt []byte) []byte {
	return argon2.IDKey([]byte(password), salt, argonTime, argonMem, argonParal, keyLen)
}

func Encrypt(key, plaintext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}

	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonce := make([]byte, aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}

	return aead.Seal(nonce, nonce, plaintext, nil), nil
}

func Decrypt(key, ciphertext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}

	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonceSize := aead.NonceSize()
	if len(ciphertext) < nonceSize {
		return nil, fmt.Errorf("ciphertext too short")
	}

	nonce, ct := ciphertext[:nonceSize], ciphertext[nonceSize:]
	return aead.Open(nil, nonce, ct, nil)
}

func HashPassword(password string) (string, error) {
	salt := GenerateSalt()
	hash := argon2.IDKey([]byte(password), salt, argonTime, argonMem, argonParal, keyLen)

	// Encode as salt:hash (both hex-encoded)
	return fmt.Sprintf("%x:%x", salt, hash), nil
}

func VerifyPassword(encoded, password string) bool {
	var saltHex, hashHex string
	_, err := fmt.Sscanf(encoded, "%64s", &saltHex)
	if err != nil {
		return false
	}

	// Split on ':'
	for i, c := range encoded {
		if c == ':' {
			saltHex = encoded[:i]
			hashHex = encoded[i+1:]
			break
		}
	}

	salt := make([]byte, len(saltHex)/2)
	fmt.Sscanf(saltHex, "%x", &salt)

	expectedHash := make([]byte, len(hashHex)/2)
	fmt.Sscanf(hashHex, "%x", &expectedHash)

	actualHash := argon2.IDKey([]byte(password), salt, argonTime, argonMem, argonParal, keyLen)

	if len(actualHash) != len(expectedHash) {
		return false
	}
	// Constant-time comparison
	var diff byte
	for i := range actualHash {
		diff |= actualHash[i] ^ expectedHash[i]
	}
	return diff == 0
}
