package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"io"
	"strings"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/bcrypt"
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

func HashKey(plaintext string) string {
	sum := sha256.Sum256([]byte(plaintext))
	return fmt.Sprintf("%x", sum)
}

func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

func VerifyPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// HashToken returns a SHA-256 hex digest of the input. Use for API tokens that
// are verified on every request — bcrypt is too slow on the hot path and gives
// an attacker a CPU-amplification DoS via random-token requests.
func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// VerifyToken constant-time compares a stored token hash against a presented
// token. Accepts either a SHA-256 hex digest (preferred, fast) or a legacy
// bcrypt hash for backwards compatibility with previously-stored tokens.
func VerifyToken(storedHash, token string) bool {
	if strings.HasPrefix(storedHash, "$2") {
		return bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(token)) == nil
	}
	got := HashToken(token)
	return subtle.ConstantTimeCompare([]byte(storedHash), []byte(got)) == 1
}
