--!strict
-- Turns a body — imported model or generated stand-in — into a car that
-- drives on real physics, and runs the engine behind it.
--
-- The rig is deliberately generic. Anything roughly car-shaped gets a chassis,
-- four wheels on constraints and a seat, so importing a new model never means
-- rewriting this file. Front wheels steer through a hub on a servo hinge and
-- roll on a second hinge, which is how a real steering axis works and why the
-- car turns instead of skidding.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local ServerScriptService = game:GetService("ServerScriptService")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Net = require(Shared:WaitForChild("Net"))
local Vehicles = require(Shared:WaitForChild("Vehicles"))

local AssetLibrary = require(ServerScriptService:WaitForChild("Server"):WaitForChild("AssetLibrary"))

local VehicleService = {}

local HALF = 2560
local SPAWN_COUNT = 22
local PLACEMENT_ATTEMPTS = 4000

type Rig = {
	model: Model,
	chassis: BasePart,
	seat: VehicleSeat,
	motors: { HingeConstraint },
	servos: { HingeConstraint },
	wheelRadius: number,

	parts: { [string]: boolean },
	fuel: number,
	coolant: number,
	running: boolean,
	burning: boolean,
}

local rigs: { Rig } = {}
local syncRemote: RemoteEvent

--- Construction ----------------------------------------------------------

local function wheelProperties(): PhysicalProperties
	-- High friction, low elasticity. Default rubber in Roblox behaves like a
	-- hockey puck and the car slides everywhere.
	return PhysicalProperties.new(1.4, 2.2, 0.1, 100, 1)
end

local function attach(parent: BasePart, position: Vector3, axis: Vector3): Attachment
	local attachment = Instance.new("Attachment")
	attachment.Position = position
	attachment.Axis = axis
	attachment.Parent = parent
	return attachment
end

local function makeWheel(model: Model, chassis: BasePart, offset: Vector3, radius: number): BasePart
	local wheel = Instance.new("Part")
	wheel.Name = "Wheel"
	wheel.Shape = Enum.PartType.Cylinder
	-- A cylinder's length runs along its local X, so leaving it unrotated
	-- already points the spin axis across the car.
	wheel.Size = Vector3.new(radius * 0.7, radius * 2, radius * 2)
	wheel.CFrame = chassis.CFrame * CFrame.new(offset)
	wheel.Color = Color3.fromRGB(32, 32, 34)
	wheel.Material = Enum.Material.Rubber
	wheel.CustomPhysicalProperties = wheelProperties()
	wheel.Parent = model
	return wheel
end

local function hinge(a: Attachment, b: Attachment, parent: Instance): HingeConstraint
	local constraint = Instance.new("HingeConstraint")
	constraint.Attachment0 = a
	constraint.Attachment1 = b
	constraint.Parent = parent
	return constraint
end

local function rigVehicle(body: Model, at: CFrame): Rig?
	local size = body:GetExtentsSize()
	if size.Magnitude < 1 then
		return nil
	end

	local model = Instance.new("Model")
	model.Name = "Vehicle"

	local chassis = Instance.new("Part")
	chassis.Name = "Chassis"
	chassis.Size = Vector3.new(size.X * 0.7, size.Y * 0.35, size.Z * 0.75)
	chassis.CFrame = at
	chassis.Transparency = 1
	chassis.CanCollide = false
	chassis.Parent = model
	model.PrimaryPart = chassis

	-- The body rides on the chassis and carries no mass of its own, so the
	-- handling comes from one predictable block rather than from whatever
	-- densities an imported model happened to ship with.
	body:PivotTo(at)
	body.Parent = model

	for _, descendant in body:GetDescendants() do
		if descendant:IsA("BasePart") then
			descendant.Anchored = false
			descendant.CanCollide = false
			descendant.Massless = true

			local weld = Instance.new("WeldConstraint")
			weld.Part0 = chassis
			weld.Part1 = descendant
			weld.Parent = chassis
		end
	end

	local radius = math.clamp(size.Y * 0.26, 1.6, 4)
	local halfWidth = size.X / 2 - radius * 0.3
	local halfLength = size.Z / 2 - radius * 1.1
	local drop = -size.Y * 0.3

	local motors, servos = {}, {}

	for _, side in { -1, 1 } do
		-- Rear: driven directly off the chassis.
		local rearOffset = Vector3.new(side * halfWidth, drop, halfLength)
		local rear = makeWheel(model, chassis, rearOffset, radius)

		local motor = hinge(
			attach(chassis, rearOffset, Vector3.new(1, 0, 0)),
			attach(rear, Vector3.zero, Vector3.new(1, 0, 0)),
			chassis
		)
		motor.ActuatorType = Enum.ActuatorType.Motor
		motor.MotorMaxAcceleration = 90
		motor.MotorMaxTorque = 0
		table.insert(motors, motor)

		-- Front: a hub that turns on a vertical servo, with the wheel rolling
		-- on a second hinge below it.
		local frontOffset = Vector3.new(side * halfWidth, drop, -halfLength)

		local hub = Instance.new("Part")
		hub.Name = "SteerHub"
		hub.Size = Vector3.new(0.6, 0.6, 0.6)
		hub.CFrame = chassis.CFrame * CFrame.new(frontOffset)
		hub.Transparency = 1
		hub.CanCollide = false
		hub.Massless = true
		hub.Parent = model

		local servo = hinge(
			attach(chassis, frontOffset, Vector3.new(0, 1, 0)),
			attach(hub, Vector3.zero, Vector3.new(0, 1, 0)),
			chassis
		)
		servo.ActuatorType = Enum.ActuatorType.Servo
		servo.ServoMaxTorque = 26000
		servo.AngularSpeed = Vehicles.SteerSpeed
		servo.TargetAngle = 0
		table.insert(servos, servo)

		local front = makeWheel(model, chassis, frontOffset, radius)
		hinge(
			attach(hub, Vector3.zero, Vector3.new(1, 0, 0)),
			attach(front, Vector3.zero, Vector3.new(1, 0, 0)),
			hub
		)
	end

	local seat = Instance.new("VehicleSeat")
	seat.Name = "DriverSeat"
	seat.Size = Vector3.new(2.4, 0.4, 2.4)
	seat.CFrame = at * CFrame.new(0, size.Y * 0.1, 0)
	seat.Transparency = 1
	seat.MaxSpeed = Vehicles.MaxSpeed
	seat.Torque = Vehicles.Torque
	seat.Parent = model

	local seatWeld = Instance.new("WeldConstraint")
	seatWeld.Part0 = chassis
	seatWeld.Part1 = seat
	seatWeld.Parent = chassis

	-- Each car is scavenged differently. Most are missing something, which is
	-- what makes finding a working one worth the walk.
	local rng = Random.new()
	local parts = {}
	for _, id in Vehicles.RequiredParts do
		parts[id] = rng:NextNumber() < 0.55
	end

	return {
		model = model,
		chassis = chassis,
		seat = seat,
		motors = motors,
		servos = servos,
		wheelRadius = radius,
		parts = parts,
		fuel = rng:NextNumber(0, Vehicles.TankLitres * 0.4),
		coolant = 20,
		running = false,
		burning = false,
	}
end

--- Fallback body ---------------------------------------------------------

-- Used until a vehicle asset id is configured, so the system is testable
-- without waiting on an import.
local function generateBody(): Model
	local body = Instance.new("Model")
	body.Name = "Hatchback"

	local shell = Instance.new("Part")
	shell.Name = "Shell"
	shell.Size = Vector3.new(7, 3.4, 14)
	shell.Color = Color3.fromRGB(104, 106, 100)
	shell.Material = Enum.Material.CorrodedMetal
	shell.Parent = body

	local cabin = Instance.new("Part")
	cabin.Name = "Cabin"
	cabin.Size = Vector3.new(6.4, 2.6, 6)
	cabin.CFrame = CFrame.new(0, 2.8, -0.6)
	cabin.Color = Color3.fromRGB(58, 62, 66)
	cabin.Material = Enum.Material.Glass
	cabin.Transparency = 0.35
	cabin.Parent = body

	body.PrimaryPart = shell
	return body
end

--- Engine ----------------------------------------------------------------

local function setDrive(rig: Rig, throttle: number, steer: number)
	local maxAngular = Vehicles.MaxSpeed / rig.wheelRadius

	for _, motor in rig.motors do
		motor.MotorMaxTorque = if rig.running then Vehicles.Torque else 0
		motor.AngularVelocity = if rig.running then -throttle * maxAngular else 0
	end

	for _, servo in rig.servos do
		servo.TargetAngle = -steer * Vehicles.SteerAngle
	end
end

local function ignite(rig: Rig)
	if rig.burning then
		return
	end
	rig.burning = true
	rig.running = false

	local fire = Instance.new("Fire")
	fire.Heat = 18
	fire.Size = 10
	fire.Parent = rig.chassis

	local smoke = Instance.new("Smoke")
	smoke.Size = 8
	smoke.Opacity = 0.5
	smoke.Parent = rig.chassis
end

local function tick(rig: Rig, delta: number)
	local occupant = rig.seat.Occupant
	local driver = if occupant then Players:GetPlayerFromCharacter(occupant.Parent) else nil

	local throttle = rig.seat.Throttle
	local steer = rig.seat.Steer

	if rig.burning then
		setDrive(rig, 0, steer)
		return
	end

	local startable, reason = Vehicles.canStart(rig.parts, rig.fuel)
	rig.running = driver ~= nil and startable

	if rig.running then
		local working = math.abs(throttle) > 0.05
		local burn = if working then Vehicles.LitresPerMinuteDriving else Vehicles.LitresPerMinuteIdle
		rig.fuel = math.max(0, rig.fuel - burn * (delta / 60))

		-- A holed radiator does not stop the car. It starts a clock.
		local heating = if rig.parts.Radiator then Vehicles.HeatPerSecondDriving else Vehicles.HeatPerSecondLeaking
		rig.coolant += heating * delta * (if working then 1 else 0.4)
	else
		rig.coolant -= Vehicles.CoolPerSecond * delta
	end

	rig.coolant = math.clamp(rig.coolant, 20, 200)

	if rig.coolant >= Vehicles.CoolantFire then
		ignite(rig)
	end

	setDrive(rig, throttle, steer)

	if driver then
		syncRemote:FireClient(driver, {
			Fuel = rig.fuel,
			Capacity = Vehicles.TankLitres,
			Coolant = rig.coolant,
			Running = rig.running,
			Reason = reason,
			Parts = rig.parts,
		})
	end
end

--- Placement -------------------------------------------------------------

local function spawnVehicles(parent: Folder)
	local rng = Random.new(777)
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = { parent }

	local spawned, attempts = 0, 0

	while spawned < SPAWN_COUNT and attempts < PLACEMENT_ATTEMPTS do
		attempts += 1

		local x = rng:NextNumber(-HALF + 100, HALF - 100)
		local z = rng:NextNumber(-HALF + 100, HALF - 100)

		local hit = Workspace:Raycast(Vector3.new(x, 400, z), Vector3.new(0, -800, 0), params)
		if not hit then
			continue
		end

		-- Abandoned cars belong on roads, and testing the material is a
		-- simpler way to find one than remembering where they were drawn.
		if hit.Material ~= Enum.Material.Asphalt then
			continue
		end

		local at = CFrame.new(hit.Position + Vector3.new(0, 4, 0))
			* CFrame.Angles(0, rng:NextNumber(0, math.pi * 2), 0)

		local body: Model?
		local loaded = AssetLibrary.place("Vehicles", hit.Position, rng, parent)
		if loaded then
			body = loaded
		else
			body = generateBody()
		end

		if not body then
			continue
		end

		local rig = rigVehicle(body, at)
		if rig then
			rig.model.Parent = parent
			table.insert(rigs, rig)
			spawned += 1
		end

		task.wait()
	end

	print(`[QZ] vehicles: {spawned} placed from {attempts} attempts`)
end

--- Public ----------------------------------------------------------------

function VehicleService.start()
	syncRemote = Net.event("VehicleSync")

	local parent = Instance.new("Folder")
	parent.Name = "Vehicles"
	parent.Parent = Workspace

	spawnVehicles(parent)

	-- Driving needs a physics-rate loop; the engine bookkeeping rides along
	-- with it rather than running a second timer.
	RunService.Heartbeat:Connect(function(delta)
		for _, rig in rigs do
			if rig.model.Parent then
				tick(rig, delta)
			end
		end
	end)
end

return VehicleService
