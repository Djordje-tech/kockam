#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerState.h"

#include "KockamPlayerState.generated.h"

/**
 * Holds a player's currency. Lives on PlayerState rather than the pawn so a
 * balance survives death, respawn and possession changes.
 */
UCLASS()
class KOCKAM_API AKockamPlayerState : public APlayerState
{
	GENERATED_BODY()

public:
	AKockamPlayerState();

	/** Server-side only. Clients receive the result through replication. */
	UFUNCTION(BlueprintCallable, Category = "Kockam")
	void AddCoins(int32 Amount);

	UFUNCTION(BlueprintPure, Category = "Kockam")
	int32 GetCoins() const { return Coins; }

	virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;

protected:
	UPROPERTY(ReplicatedUsing = OnRep_Coins, VisibleAnywhere, Category = "Kockam")
	int32 Coins = 0;

	UFUNCTION()
	void OnRep_Coins();

private:
	/** Draws the balance on screen. Placeholder until there is a real HUD. */
	void ShowBalance() const;
};
