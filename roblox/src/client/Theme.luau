--!strict
-- One palette for the whole interface. Concrete, rust and sodium light — the
-- game is set in a quarantined city, and the UI should feel like it was
-- printed on something found there.

return {
	Panel = Color3.fromRGB(24, 24, 26),
	PanelEdge = Color3.fromRGB(58, 56, 52),
	Sunk = Color3.fromRGB(16, 16, 18),

	Text = Color3.fromRGB(228, 226, 220),
	Muted = Color3.fromRGB(148, 144, 136),

	Amber = Color3.fromRGB(226, 168, 62),
	Good = Color3.fromRGB(130, 206, 140),
	Bad = Color3.fromRGB(214, 96, 92),

	Corner = UDim.new(0, 6),
	Font = Enum.Font.GothamBold,
	Body = Enum.Font.Gotham,
}
