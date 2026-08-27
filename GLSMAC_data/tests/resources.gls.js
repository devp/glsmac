const mocks = #include('./_mocks');
const resources = #include('../default/resources');

const capture = mocks.capture_tm_handler('get_tile_resources');
resources.configure(capture.game);

const handler = capture.get();

// Create resource event with empty land tile. (Tests override tile values.)
const resource_event = (player_id) => {
	return {
		player: {
			id: player_id,
		},
		tile: {
			features: {
				xenofungus: false,
				jungle: false,
				river: false,
			},
			bonuses: {
				nutrient: false,
				minerals: false,
				energy: false,
			},
			is_land: true,
			rockiness: 0,
			moisture: 1,
			get_base: () => {
				return null;
			},
		},
	};
};

// Empty tile => 0
const empty_result = handler(resource_event(0));
test.assert(empty_result.NUTRIENTS == 0);
test.assert(empty_result.MINERALS == 0);
test.assert(empty_result.ENERGY == 0);

// Land tile => value based on features
let land_event = resource_event(0);
land_event.tile.moisture = 3;
land_event.tile.rockiness = 2;
land_event.tile.features.jungle = true;
land_event.tile.features.river = true;
land_event.tile.bonuses.nutrient = true;
land_event.tile.bonuses.minerals = true;
land_event.tile.bonuses.energy = true;
const land_result = handler(land_event);
test.assert(land_result.NUTRIENTS == 5); // (moisture 3 - 1) + jungle 1 + bonus 2
test.assert(land_result.MINERALS == 3); // rockiness>1 -> 1, + bonus 2
test.assert(land_result.ENERGY == 3); // river 1 + bonus 2

// Xenofungus tiles use the placeholder bonuses (TODO: real tech-based calculation)
let fungus_event = resource_event(0);
fungus_event.tile.features.xenofungus = true;
const fungus_result = handler(fungus_event);
test.assert(fungus_result.NUTRIENTS == 1);
test.assert(fungus_result.MINERALS == 0);
test.assert(fungus_result.ENERGY == 0);
