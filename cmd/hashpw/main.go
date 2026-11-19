// Command hashpw generates a bcrypt hash for an operator password, for use as
// ORTEX_OPERATOR_PASSWORD_HASH. Usage:
//
//	go run ./cmd/hashpw 'my-strong-password'
//
// If no argument is given, the password is read from stdin.
package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

func main() {
	var pw string
	if len(os.Args) > 1 {
		pw = os.Args[1]
	} else {
		r := bufio.NewReader(os.Stdin)
		line, _ := r.ReadString('\n')
		pw = strings.TrimRight(line, "\r\n")
	}
	if pw == "" {
		fmt.Fprintln(os.Stderr, "usage: hashpw '<password>'  (or pipe the password on stdin)")
		os.Exit(2)
	}
	h, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
	fmt.Println(string(h))
}
