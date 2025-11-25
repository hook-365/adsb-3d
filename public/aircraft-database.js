// ============================================================================
// AIRCRAFT DATABASE MODULE
// ============================================================================
// Manages military aircraft database and aircraft performance specifications

// Import dependencies
import { API, CACHE, STORAGE_KEYS } from './constants.js';

// ============================================================================
// MILITARY AIRCRAFT DATABASE
// ============================================================================
// Military aircraft database (loaded from tar1090-db)
// Structure: { "ICAO_HEX": { tail, type, flag, description }, ... }

let militaryDatabase = {};
let militaryDatabaseLoaded = false;

/**
 * Load military aircraft database from tar1090-db (Mictronics/readsb-protobuf)
 * @param {Object} SafeStorage - Storage utility reference
 * @returns {Promise<void>}
 */
export async function loadMilitaryDatabase(SafeStorage) {
    const CACHE_KEY = 'military_aircraft_db';
    const CACHE_DURATION = CACHE.MILITARY_DATABASE;

    try {
        // Check localStorage cache first
        const cached = SafeStorage.getItem(CACHE_KEY);
        if (cached) {
            try {
                const { data, timestamp } = JSON.parse(cached);
                const age = Date.now() - timestamp;

                if (age < CACHE_DURATION) {
                    // Use cached data
                    militaryDatabase = data;
                    militaryDatabaseLoaded = true;
                    console.log(`Military database loaded from cache: ${Object.keys(data).length} aircraft (${(age / 3600000).toFixed(1)}h old)`);

                    // Update in background (non-blocking)
                    fetchAndCacheMilitaryDatabase(SafeStorage);
                    return;
                }
            } catch (e) {
                console.warn('Failed to parse cached military database:', e);
            }
        }

        // No cache or expired - fetch now
        await fetchAndCacheMilitaryDatabase(SafeStorage);

    } catch (error) {
        console.error('Error loading military database:', error);
    }
}

/**
 * Fetch military database from API and cache it
 * @param {Object} SafeStorage - Storage utility reference
 * @returns {Promise<void>}
 */
async function fetchAndCacheMilitaryDatabase(SafeStorage) {
    try {
        const response = await fetch(API.MILITARY_DATABASE);

        if (!response.ok) {
            console.error('Failed to fetch military database:', response.status);
            return;
        }

        const dbData = await response.json();

        // Extract only military aircraft (flag "10")
        const newMilitaryDb = {};
        let militaryCount = 0;
        for (const [icaoHex, aircraftInfo] of Object.entries(dbData)) {
            // aircraftInfo = [tail, type, flag, description]
            if (aircraftInfo.length >= 3 && aircraftInfo[2] === "10") {
                newMilitaryDb[icaoHex.toUpperCase()] = {
                    tail: aircraftInfo[0],
                    type: aircraftInfo[1],
                    flag: aircraftInfo[2],
                    description: aircraftInfo.length > 3 ? aircraftInfo[3] : ""
                };
                militaryCount++;
            }
        }

        militaryDatabase = newMilitaryDb;
        militaryDatabaseLoaded = true;
        console.log(`Military database fetched: ${militaryCount} verified military aircraft`);

        // Cache for 24 hours
        try {
            SafeStorage.setItem('military_aircraft_db', JSON.stringify({
                data: newMilitaryDb,
                timestamp: Date.now()
            }));
        } catch (e) {
            console.warn('Failed to cache military database:', e);
        }

    } catch (error) {
        console.error('Error fetching military database:', error);
    }
}

/**
 * Check if aircraft is military using tar1090-db database
 * @param {string} hex - Aircraft ICAO hex code
 * @returns {boolean} True if aircraft is military
 */
export function isMilitaryAircraft(hex) {
    if (!hex || !militaryDatabaseLoaded) return false;
    return militaryDatabase.hasOwnProperty(hex.toUpperCase());
}

/**
 * Get military aircraft info from database
 * @param {string} hex - Aircraft ICAO hex code
 * @returns {Object|null} Military aircraft info or null
 */
export function getMilitaryInfo(hex) {
    if (!hex || !militaryDatabaseLoaded) return null;
    return militaryDatabase[hex.toUpperCase()] || null;
}

// ============================================================================
// AIRCRAFT TYPE SPECIFICATIONS
// ============================================================================

/**
 * @typedef {Object} AircraftSpec
 * @property {number} cruise - Cruise speed in knots
 * @property {number} maxAlt - Maximum altitude in feet
 * @property {number} range - Range in nautical miles
 */

/**
 * Aircraft type specifications database
 * Data source: Various aviation references, manufacturer specs
 * @type {Object.<string, {cruise: number, maxAlt: number, range: number}>}
 */
export const AIRCRAFT_TYPE_SPECS = {
    // === Commercial Jets (Airbus) ===
    'A319': { cruise: 447, maxAlt: 39000, range: 3700 },
    'A320': { cruise: 450, maxAlt: 39000, range: 3300 },
    'A321': { cruise: 450, maxAlt: 39000, range: 3200 },
    'A20N': { cruise: 450, maxAlt: 39800, range: 3500 },  // A320neo
    'A21N': { cruise: 450, maxAlt: 39800, range: 4000 },  // A321neo
    'A332': { cruise: 470, maxAlt: 42650, range: 7200 },  // A330-200
    'A333': { cruise: 470, maxAlt: 41450, range: 6350 },  // A330-300
    'A339': { cruise: 470, maxAlt: 41100, range: 7200 },  // A330-900neo
    'A359': { cruise: 488, maxAlt: 43100, range: 8100 },  // A350-900
    'A35K': { cruise: 488, maxAlt: 43100, range: 9700 },  // A350-1000
    'A388': { cruise: 490, maxAlt: 43000, range: 8000 },  // A380

    // === Commercial Jets (Boeing) ===
    'B737': { cruise: 450, maxAlt: 41000, range: 3000 },  // Generic 737
    'B738': { cruise: 453, maxAlt: 41000, range: 3115 },  // 737-800
    'B739': { cruise: 453, maxAlt: 41000, range: 3235 },  // 737-900
    'B37M': { cruise: 453, maxAlt: 41000, range: 3550 },  // 737 MAX 7
    'B38M': { cruise: 453, maxAlt: 41000, range: 3550 },  // 737 MAX 8
    'B39M': { cruise: 453, maxAlt: 41000, range: 3550 },  // 737 MAX 9
    'B3JM': { cruise: 453, maxAlt: 41000, range: 3700 },  // 737 MAX 10
    'B752': { cruise: 459, maxAlt: 42000, range: 3900 },  // 757-200
    'B753': { cruise: 459, maxAlt: 42000, range: 3395 },  // 757-300
    'B762': { cruise: 470, maxAlt: 43100, range: 6385 },  // 767-200
    'B763': { cruise: 470, maxAlt: 43100, range: 5990 },  // 767-300
    'B764': { cruise: 470, maxAlt: 43100, range: 5625 },  // 767-400
    'B772': { cruise: 490, maxAlt: 43100, range: 7730 },  // 777-200
    'B773': { cruise: 490, maxAlt: 43100, range: 7370 },  // 777-300
    'B77W': { cruise: 490, maxAlt: 43100, range: 8555 },  // 777-300ER
    'B77L': { cruise: 490, maxAlt: 43100, range: 8700 },  // 777-200LR
    'B788': { cruise: 488, maxAlt: 43000, range: 7355 },  // 787-8
    'B789': { cruise: 488, maxAlt: 43000, range: 7635 },  // 787-9
    'B78J': { cruise: 488, maxAlt: 43000, range: 6430 },  // 787-10
    'B748': { cruise: 493, maxAlt: 43100, range: 8000 },  // 747-8

    // === Regional Jets (Bombardier/Airbus Canada) ===
    'CRJ2': { cruise: 450, maxAlt: 41000, range: 1700 },  // CRJ-200
    'CRJ7': { cruise: 447, maxAlt: 41000, range: 1650 },  // CRJ-700
    'CRJ9': { cruise: 447, maxAlt: 41000, range: 1650 },  // CRJ-900
    'CRJX': { cruise: 447, maxAlt: 41000, range: 1650 },  // CRJ-1000
    'BCS1': { cruise: 447, maxAlt: 41000, range: 3400 },  // A220-100 (CS100)
    'BCS3': { cruise: 447, maxAlt: 41000, range: 3350 },  // A220-300 (CS300)

    // === Regional Jets (Embraer) ===
    'E170': { cruise: 447, maxAlt: 41000, range: 2150 },  // E170
    'E175': { cruise: 447, maxAlt: 41000, range: 2200 },  // E175
    'E75L': { cruise: 447, maxAlt: 41000, range: 2200 },  // E175 (long wing)
    'E75S': { cruise: 447, maxAlt: 41000, range: 2200 },  // E175 (short wing)
    'E190': { cruise: 470, maxAlt: 41000, range: 2400 },  // E190
    'E195': { cruise: 470, maxAlt: 41000, range: 2300 },  // E195
    'E290': { cruise: 470, maxAlt: 41000, range: 2600 },  // E190-E2
    'E295': { cruise: 470, maxAlt: 41000, range: 2600 },  // E195-E2

    // === Turboprops ===
    'AT72': { cruise: 276, maxAlt: 25000, range: 900 },   // ATR 72
    'AT75': { cruise: 276, maxAlt: 25000, range: 950 },   // ATR 72-600
    'AT76': { cruise: 276, maxAlt: 25000, range: 950 },   // ATR 72-600
    'DH8D': { cruise: 360, maxAlt: 25000, range: 1200 },  // Dash 8 Q400

    // === Business Jets ===
    'C25C': { cruise: 460, maxAlt: 51000, range: 2000 },  // Citation CJ4
    'C56X': { cruise: 528, maxAlt: 51000, range: 3450 },  // Citation Excel
    'C680': { cruise: 538, maxAlt: 51000, range: 3400 },  // Citation Sovereign
    'CL60': { cruise: 459, maxAlt: 51000, range: 3200 },  // Challenger 600
    'GLF4': { cruise: 488, maxAlt: 51000, range: 4220 },  // Gulfstream IV
    'GLF5': { cruise: 516, maxAlt: 51000, range: 6500 },  // Gulfstream V
    'GLF6': { cruise: 516, maxAlt: 51000, range: 6500 },  // Gulfstream 650
    'GLEX': { cruise: 488, maxAlt: 51000, range: 4000 },  // Bombardier Global Express
    'FA7X': { cruise: 488, maxAlt: 51000, range: 5950 },  // Dassault Falcon 7X
    'FA50': { cruise: 540, maxAlt: 51000, range: 3350 },  // Dassault Falcon 50

    // === General Aviation ===
    'C152': { cruise: 107, maxAlt: 14700, range: 415 },   // Cessna 152
    'C172': { cruise: 122, maxAlt: 14000, range: 640 },   // Cessna 172
    'C182': { cruise: 145, maxAlt: 18100, range: 915 },   // Cessna 182
    'C206': { cruise: 151, maxAlt: 16500, range: 840 },   // Cessna 206
    'C208': { cruise: 186, maxAlt: 25000, range: 1070 },  // Cessna Caravan
    'P28A': { cruise: 113, maxAlt: 11000, range: 460 },   // Piper PA-28 Cherokee
    'PA46': { cruise: 225, maxAlt: 25000, range: 1300 },  // Piper Malibu
    'SR22': { cruise: 183, maxAlt: 17500, range: 1200 },  // Cirrus SR22

    // === Military (Common Types) ===
    'F16': { cruise: 570, maxAlt: 50000, range: 2280 },   // F-16 Fighting Falcon
    'F18': { cruise: 570, maxAlt: 50000, range: 1250 },   // F/A-18 Hornet
    'F35': { cruise: 570, maxAlt: 50000, range: 1200 },   // F-35 Lightning II
    'A10': { cruise: 340, maxAlt: 45000, range: 800 },    // A-10 Thunderbolt II
    'C130': { cruise: 336, maxAlt: 33000, range: 2360 },  // C-130 Hercules
    'C17': { cruise: 450, maxAlt: 45000, range: 2400 },   // C-17 Globemaster III
    'C5': { cruise: 518, maxAlt: 42000, range: 5200 },    // C-5 Galaxy
    'KC135': { cruise: 530, maxAlt: 50000, range: 1500 }, // KC-135 Stratotanker
    'KC10': { cruise: 493, maxAlt: 42000, range: 4400 },  // KC-10 Extender
    'P8': { cruise: 490, maxAlt: 41000, range: 1200 },    // P-8 Poseidon

    // === Cargo ===
    'MD11': { cruise: 482, maxAlt: 42000, range: 6800 },  // MD-11
    'B744': { cruise: 493, maxAlt: 45000, range: 7670 },  // 747-400
    'B74S': { cruise: 493, maxAlt: 43100, range: 4400 },  // 747-400SF (cargo)
};

/**
 * Get aircraft performance specifications
 * @param {string} typeCode - ICAO type designator (e.g., 'B738', 'A320')
 * @returns {{cruise: number, maxAlt: number, range: number} | null} Specs or null if unknown
 */
export function getAircraftSpecs(typeCode) {
    if (!typeCode || typeof typeCode !== 'string') {
        return null;
    }

    // Convert to uppercase for case-insensitive lookup
    const normalizedType = typeCode.trim().toUpperCase();

    return AIRCRAFT_TYPE_SPECS[normalizedType] || null;
}

// Expose AircraftDatabase globally for smoke tests
window.AircraftDatabase = {
    loadMilitaryDatabase,
    isMilitaryAircraft,
    getMilitaryInfo,
    getAircraftSpecs,
    AIRCRAFT_TYPE_SPECS
};
