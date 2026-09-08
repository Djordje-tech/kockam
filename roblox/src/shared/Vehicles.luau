--!strict
-- What a vehicle is made of and what it needs to run.
--
-- An engine is not a boolean. Each part is present or absent, healthy or
-- damaged, and the car's behaviour is derived from that rather than from a
-- "working" flag — which is what makes scavenging for a single spark plug a
-- real objective.

export type PartId = "Battery" | "Alternator" | "SparkPlugs" | "Radiator"

local Vehicles = {}

-- Every part is required to start. They fail differently once running, which
-- is the interesting half.
Vehicles.RequiredParts = { "Battery", "Alternator", "SparkPlugs", "Radiator" }

Vehicles.PartNames = {
	Battery = "12v battery",
	Alternator = "alternator",
	SparkPlugs = "spark plugs",
	Radiator = "radiator",
}

--- Engine ----------------------------------------------------------------

-- A 1.2L hatchback: economical, gutless, no armour. The numbers are picked to
-- feel like that rather than like a go-kart.
Vehicles.MaxSpeed = 78              -- studs/s, about 80 km/h
Vehicles.Torque = 3200
Vehicles.SteerAngle = 32            -- degrees of lock
Vehicles.SteerSpeed = 5

--- Consumables -----------------------------------------------------------

Vehicles.TankLitres = 42
Vehicles.LitresPerMinuteIdle = 0.6
Vehicles.LitresPerMinuteDriving = 4.5

--- Thermal --------------------------------------------------------------

Vehicles.CoolantNormal = 88         -- degrees C
Vehicles.CoolantWarning = 108
Vehicles.CoolantFire = 125

-- A holed radiator does not stop the car. It starts a clock, which is a far
-- worse thing to discover halfway across a valley.
Vehicles.HeatPerSecondDriving = 0.9
Vehicles.HeatPerSecondLeaking = 5.5
Vehicles.CoolPerSecond = 2.2

--- Damage ---------------------------------------------------------------

Vehicles.BodyHealth = 260

function Vehicles.canStart(parts: { [string]: boolean }, fuel: number): (boolean, string?)
	if fuel <= 0 then
		return false, "no fuel"
	end

	for _, id in Vehicles.RequiredParts do
		if not parts[id] then
			return false, `missing {Vehicles.PartNames[id]}`
		end
	end

	return true, nil
end

return Vehicles
