#include "KockamGameMode.h"

#include "GameFramework/DefaultPawn.h"
#include "KockamPlayerState.h"

AKockamGameMode::AKockamGameMode()
{
	DefaultPawnClass = ADefaultPawn::StaticClass();
	PlayerStateClass = AKockamPlayerState::StaticClass();
}
