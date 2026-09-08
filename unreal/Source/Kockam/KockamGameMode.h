#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"

#include "KockamGameMode.generated.h"

/**
 * Wires up the pawn and player state. Deliberately asset-free: it uses the
 * engine's built-in flying pawn so the project is playable the moment it
 * compiles, before any art exists.
 */
UCLASS()
class KOCKAM_API AKockamGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	AKockamGameMode();
};
