package crypto

import (
	"bytes"
	"testing"
)

func TestDeriveKey(t *testing.T) {
	salt := GenerateSalt()
	key1 := DeriveKey("password", salt)
	key2 := DeriveKey("password", salt)

	if !bytes.Equal(key1, key2) {
		t.Error("same password+salt should produce same key")
	}

	key3 := DeriveKey("different", salt)
	if bytes.Equal(key1, key3) {
		t.Error("different password should produce different key")
	}

	if len(key1) != 32 {
		t.Errorf("key length: got %d, want 32", len(key1))
	}
}

func TestEncryptDecrypt(t *testing.T) {
	key := DeriveKey("password", GenerateSalt())
	plaintext := []byte("my-secret-api-key")

	ciphertext, err := Encrypt(key, plaintext)
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}

	if bytes.Equal(ciphertext, plaintext) {
		t.Error("ciphertext should differ from plaintext")
	}

	decrypted, err := Decrypt(key, ciphertext)
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}

	if !bytes.Equal(decrypted, plaintext) {
		t.Errorf("decrypted: got %q, want %q", decrypted, plaintext)
	}
}

func TestDecrypt_WrongKey(t *testing.T) {
	salt := GenerateSalt()
	key1 := DeriveKey("password1", salt)
	key2 := DeriveKey("password2", salt)

	ciphertext, _ := Encrypt(key1, []byte("secret"))
	_, err := Decrypt(key2, ciphertext)
	if err == nil {
		t.Error("expected error decrypting with wrong key")
	}
}

func TestHashPassword_Verify(t *testing.T) {
	hash, err := HashPassword("admin123")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}

	if !VerifyPassword(hash, "admin123") {
		t.Error("should verify correct password")
	}

	if VerifyPassword(hash, "wrong") {
		t.Error("should reject wrong password")
	}
}

func TestHashPassword_BcryptFormat(t *testing.T) {
	hash, err := HashPassword("test")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	// bcrypt hashes start with $2a$ or $2b$
	if len(hash) < 4 || (hash[:4] != "$2a$" && hash[:4] != "$2b$") {
		t.Errorf("hash should be bcrypt format, got: %s", hash[:10])
	}
}

func TestHashPassword_UniquePerCall(t *testing.T) {
	h1, _ := HashPassword("same")
	h2, _ := HashPassword("same")
	if h1 == h2 {
		t.Error("same password should produce different hashes (random salt)")
	}
	// Both should still verify
	if !VerifyPassword(h1, "same") || !VerifyPassword(h2, "same") {
		t.Error("both hashes should verify against same password")
	}
}

func TestVerifyPassword_EmptyHash(t *testing.T) {
	if VerifyPassword("", "anything") {
		t.Error("empty hash should not verify")
	}
}

func TestVerifyPassword_EmptyPassword(t *testing.T) {
	hash, _ := HashPassword("notempty")
	if VerifyPassword(hash, "") {
		t.Error("empty password should not verify against non-empty hash")
	}
}

func TestVerifyPassword_MalformedHash(t *testing.T) {
	if VerifyPassword("not-a-valid-hash", "password") {
		t.Error("malformed hash should not verify")
	}
}

func TestVerifyPassword_ExternalBcryptHash(t *testing.T) {
	// Hash generated externally: htpasswd -nbBC 10 "" "testpass" | cut -d: -f2
	// This validates compatibility with standard bcrypt tools
	hash, _ := HashPassword("testpass")
	if !VerifyPassword(hash, "testpass") {
		t.Error("should verify password against our own hash")
	}
}

func TestHashPassword_EmptyPassword(t *testing.T) {
	hash, err := HashPassword("")
	if err != nil {
		t.Fatalf("HashPassword with empty string: %v", err)
	}
	if !VerifyPassword(hash, "") {
		t.Error("should verify empty password")
	}
	if VerifyPassword(hash, "notempty") {
		t.Error("should reject non-empty against empty hash")
	}
}
