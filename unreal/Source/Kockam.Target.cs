using UnrealBuildTool;

public class KockamTarget : TargetRules
{
	public KockamTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;

		// "Latest" rather than a pinned version, so the project opens against
		// whichever UE 5.x is installed instead of demanding one exact build.
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;

		ExtraModuleNames.Add("Kockam");
	}
}
