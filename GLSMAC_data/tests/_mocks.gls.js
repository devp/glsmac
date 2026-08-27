// Shared mocks for gls script tests.

// NOTE: only tile manager is mocked so far. If other subsystems need mocking,
// split them into their own factories (create_tm, ...) and let each test compose
// what it needs, rather than growing create_game into an all-encompassing mock.

// Minimal game mock; tm_on receives every tile manager handler registration
const create_game = (tm_on) => {
	const tm = {
		on: tm_on,
	};
	return {
		event: (name, data) => {},
		get_tm: () => {
			return tm;
		},
	};
};

// Game mock that captures the tile manager handler of a single event
const capture_tm_handler = (event_name) => {
	let handler = null;
	const game = create_game((event, cb) => {
		if (event == event_name) {
			handler = cb;
		}
	});
	return {
		game: game,
		get: () => {
			return handler;
		},
	};
};

return {
	capture_tm_handler: capture_tm_handler
};
