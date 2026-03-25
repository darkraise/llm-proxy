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
