#ifdef __APPLE__

#include "AppleMainThread.h"

#include <dispatch/dispatch.h>
#include <CoreFoundation/CoreFoundation.h>

namespace util {

void AppleMainThread::Run( const std::function< void() >& f ) {
	// SDL3's Cocoa backend itself uses dispatch_sync( dispatch_get_main_queue(), ... ) internally
	// (e.g. for GL context binding), which only ever gets serviced while the main thread's
	// CFRunLoop is spinning (see Pump() below) - so route our own marshaled calls through the
	// same GCD main queue rather than a custom condition-variable queue, to stay compatible.
	dispatch_sync_f(
		dispatch_get_main_queue(),
		(void*)&f,
		[]( void* ctx ) {
			( *reinterpret_cast< const std::function< void() >* >( ctx ) )();
		}
	);
}

void AppleMainThread::Pump( const std::atomic< bool >& running ) {
	while ( running ) {
		CFRunLoopRunInMode( kCFRunLoopDefaultMode, 0.02, false );
	}
}

}

#endif
