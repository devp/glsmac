#pragma once

#ifdef __APPLE__

#include <functional>
#include <atomic>

namespace util {

// Marshals calls that Apple's Cocoa/AppKit require to run on the real process main thread
// (e.g. NSWindow creation) from GLSMAC's own worker threads, which are all spawned std::threads
// distinct from the actual main thread ( see Engine::Run() ).
class AppleMainThread {
public:
	// Call from the real process main thread only. Services queued Run() calls until
	// 'running' is cleared.
	static void Pump( const std::atomic< bool >& running );

	// Call from any thread other than the real main thread. Blocks until 'f' has run there.
	static void Run( const std::function< void() >& f );
};

}

#endif
