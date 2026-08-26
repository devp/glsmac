const resources = #include('../default/resources');

let handler = null;
const fake_tm = {
	on: (event, cb) => {
		if (event == 'get_tile_resources') {
			handler = cb;
		}
	},
};
const fake_game = {
	event: (name, data) => {},
	get_tm: () => {
		return fake_tm;
	},
};

resources.configure(fake_game);
test.assert(handler != null);

// xenofungus tiles use the placeholder bonuses (TODO: real tech-based calculation)
const fungus_result = handler({
	tile: {
		features: {
			xenofungus: true,
			jungle: false,
			river: false,
		},
		is_land: true,
		rockiness: 2,
		moisture: 3,
		bonuses: {
			nutrient: false,
			minerals: false,
			energy: false,
		},
		get_base: () => {
			return null;
		},
	},
});
test.assert(fungus_result.NUTRIENTS == 1);
test.assert(fungus_result.MINERALS == 0);
test.assert(fungus_result.ENERGY == 0);

// non-fungus tiles are unaffected by the xeno-bonus refactor
const land_result = handler({
	tile: {
		features: {
			xenofungus: false,
			jungle: true,
			river: true,
		},
		is_land: true,
		rockiness: 2,
		moisture: 3,
		bonuses: {
			nutrient: true,
			minerals: true,
			energy: true,
		},
		get_base: () => {
			return null;
		},
	},
});
test.assert(land_result.NUTRIENTS == 5); // (moisture 3 - 1) + jungle 1 + bonus 2
test.assert(land_result.MINERALS == 3); // rockiness>1 -> 1, + bonus 2
test.assert(land_result.ENERGY == 3); // river 1 + bonus 2
