package httpapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const sessionCookie = "ortex_session"

// Authenticator verifies operator credentials and issues/validates signed
// session cookies. The single operator credential comes from configuration
// (bcrypt password hash); session cookies are HMAC-signed with a secret.
type Authenticator struct {
	user         string
	passwordHash []byte
	secret       []byte
	ttl          time.Duration
}

// NewAuthenticator builds an Authenticator.
func NewAuthenticator(user, passwordHash, secret string) *Authenticator {
	return &Authenticator{
		user:         user,
		passwordHash: []byte(passwordHash),
		secret:       []byte(secret),
		ttl:          12 * time.Hour,
	}
}

// Verify checks a username/password pair against the configured credential.
func (a *Authenticator) Verify(user, password string) bool {
	if subtle.ConstantTimeCompare([]byte(user), []byte(a.user)) != 1 {
		// Still run bcrypt to reduce user-enumeration timing differences.
		_ = bcrypt.CompareHashAndPassword(a.passwordHash, []byte(password))
		return false
	}
	return bcrypt.CompareHashAndPassword(a.passwordHash, []byte(password)) == nil
}

// issue creates a signed session token: base64(user|expiryUnix|hmac).
func (a *Authenticator) issue(user string) string {
	exp := time.Now().Add(a.ttl).Unix()
	payload := fmt.Sprintf("%s|%d", user, exp)
	mac := a.sign(payload)
	return base64.RawURLEncoding.EncodeToString([]byte(payload + "|" + mac))
}

func (a *Authenticator) sign(payload string) string {
	m := hmac.New(sha256.New, a.secret)
	m.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

// validate parses and verifies a session token, returning the username.
func (a *Authenticator) validate(token string) (string, bool) {
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return "", false
	}
	parts := strings.Split(string(raw), "|")
	if len(parts) != 3 {
		return "", false
	}
	user, expStr, mac := parts[0], parts[1], parts[2]
	payload := user + "|" + expStr
	if subtle.ConstantTimeCompare([]byte(mac), []byte(a.sign(payload))) != 1 {
		return "", false
	}
	var exp int64
	if _, err := fmt.Sscanf(expStr, "%d", &exp); err != nil {
		return "", false
	}
	if time.Now().Unix() > exp {
		return "", false
	}
	return user, true
}

// SetSessionCookie writes the session cookie to the response.
func (a *Authenticator) SetSessionCookie(w http.ResponseWriter, user string) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    a.issue(user),
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		Secure:   false, // set true behind TLS in production
		Expires:  time.Now().Add(a.ttl),
	})
}

// ClearSessionCookie expires the session cookie.
func (a *Authenticator) ClearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: "", Path: "/", HttpOnly: true,
		MaxAge: -1, Expires: time.Unix(0, 0),
	})
}

// Middleware rejects requests without a valid session cookie.
func (a *Authenticator) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(sessionCookie)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "authentication required")
			return
		}
		if _, ok := a.validate(c.Value); !ok {
			writeError(w, http.StatusUnauthorized, "invalid or expired session")
			return
		}
		next.ServeHTTP(w, r)
	})
}
