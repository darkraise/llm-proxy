package scanner

import (
	"sync"
	"testing"
	"time"
)

func TestGitHubSource_ConcurrentConfigAccess(t *testing.T) {
	gs := NewGitHubSource("fake-token")

	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		for i := 0; i < 100; i++ {
			gs.SetDelay(time.Duration(i) * time.Millisecond)
			gs.SetMaxPages(i + 1)
		}
	}()

	go func() {
		defer wg.Done()
		for i := 0; i < 100; i++ {
			_ = gs.Delay()
			_ = gs.MaxPages()
		}
	}()

	wg.Wait()
}
