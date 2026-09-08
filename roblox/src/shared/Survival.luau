--!strict
-- The physiological model. Pure numbers and formulas, no state and no
-- instances, so the server can drive it and the client can draw honest bars
-- from the same source.
--
-- Everything here is modelled on real physiology rather than game bars. That
-- is the point of the design: the player should be able to reason about their
-- body the way they reason about their own.

local Survival = {}

--- Anaerobic output ------------------------------------------------------

-- Sprinting is high-intensity anaerobic work, not a battery. Lactate
-- accumulates while sprinting and clears while walking or standing.
--
-- The sprint ceiling is a hard 46.14 seconds of continuous output before
-- muscle failure, so lactate is normalised to reach 1.0 in exactly that time.
Survival.SprintLimitSeconds = 46.14
Survival.LactateRise = 1 / 46.14

-- Clearing is far slower than accumulation, which is what makes sprint
-- budgeting a real decision instead of a cooldown.
Survival.LactateClearWalking = 1 / 70
Survival.LactateClearResting = 1 / 42

-- Past failure the player cannot sprint again until they have cleared back
-- down to this. A hard floor, not a tap you can feather.
Survival.RecoveryThreshold = 0.35

--- Load ------------------------------------------------------------------

-- Kilograms carried before penalties begin, and the point at which the player
-- is barely mobile.
Survival.ComfortableLoadKg = 12
Survival.MaxLoadKg = 30

--- Movement --------------------------------------------------------------

Survival.WalkSpeed = 10
Survival.SprintSpeed = 21
Survival.ExhaustedSpeed = 6
Survival.JumpPower = 46

--- Metabolism ------------------------------------------------------------

-- Percent lost per minute at rest. Sprinting multiplies these.
Survival.CarbDrain = 0.16
Survival.ProteinDrain = 0.05
Survival.HydrationDrain = 0.22

Survival.SprintMetabolicMultiplier = 5.5
Survival.WalkMetabolicMultiplier = 1.8

--- Thermoregulation ------------------------------------------------------

Survival.CoreTempNormal = 37
Survival.HypothermiaOnset = 35.5
Survival.HyperthermiaOnset = 38.5
Survival.CoreTempCritical = 33

-- Degrees the core moves per minute toward the effective ambient. Slow,
-- because a body is a large thermal mass.
Survival.ThermalRate = 0.55

--- Derived values --------------------------------------------------------

export type Vitals = {
	Lactate: number,       -- 0 clear, 1 muscle failure
	Exhausted: boolean,    -- true until cleared back below RecoveryThreshold
	Carbs: number,         -- 0-100
	Protein: number,       -- 0-100
	Hydration: number,     -- 0-100
	CoreTemp: number,      -- degrees C
	LoadKg: number,
}

-- 0 when unburdened, 1 at the maximum load. Everything that load affects
-- reads this rather than the raw weight.
function Survival.encumbrance(loadKg: number): number
	if loadKg <= Survival.ComfortableLoadKg then
		return 0
	end

	local over = loadKg - Survival.ComfortableLoadKg
	local range = Survival.MaxLoadKg - Survival.ComfortableLoadKg
	return math.clamp(over / range, 0, 1)
end

-- Dehydration and low blood sugar both slow lactate clearance, which is the
-- mechanism that makes neglecting food and water felt rather than announced.
function Survival.clearanceMultiplier(vitals: Vitals): number
	local hydration = math.clamp(vitals.Hydration / 100, 0, 1)
	local carbs = math.clamp(vitals.Carbs / 100, 0, 1)

	-- Never fully stalls; a starving player still recovers, just badly.
	return 0.35 + 0.4 * hydration + 0.25 * carbs
end

function Survival.walkSpeed(vitals: Vitals): number
	if vitals.Exhausted then
		return Survival.ExhaustedSpeed
	end

	-- A fully loaded pack costs about a third of walking pace.
	return Survival.WalkSpeed * (1 - 0.32 * Survival.encumbrance(vitals.LoadKg))
end

function Survival.sprintSpeed(vitals: Vitals): number
	return Survival.SprintSpeed * (1 - 0.4 * Survival.encumbrance(vitals.LoadKg))
end

function Survival.jumpPower(vitals: Vitals): number
	local loaded = 1 - 0.45 * Survival.encumbrance(vitals.LoadKg)
	local tired = if vitals.Exhausted then 0.7 else 1
	return Survival.JumpPower * loaded * tired
end

-- Protein sustains muscle, so a protein-starved player carries less before
-- the penalties bite.
function Survival.carryCapacityKg(vitals: Vitals): number
	local protein = math.clamp(vitals.Protein / 100, 0, 1)
	return Survival.MaxLoadKg * (0.6 + 0.4 * protein)
end

function Survival.canSprint(vitals: Vitals): boolean
	if vitals.Exhausted then
		return false
	end
	if vitals.Lactate >= 1 then
		return false
	end
	-- Nothing sprints on empty.
	return vitals.Hydration > 5 and vitals.Carbs > 3
end

function Survival.newVitals(): Vitals
	return {
		Lactate = 0,
		Exhausted = false,
		Carbs = 70,
		Protein = 70,
		Hydration = 80,
		CoreTemp = Survival.CoreTempNormal,
		LoadKg = 0,
	}
end

return Survival
