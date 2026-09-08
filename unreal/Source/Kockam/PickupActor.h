#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"

#include "PickupActor.generated.h"

class USphereComponent;
class UStaticMeshComponent;

/**
 * A collectable that pays the overlapping pawn and comes back after a delay.
 *
 * Every tunable is a UPROPERTY, so the whole thing can be rebalanced from the
 * Details panel — or from a Python build script — without a recompile.
 */
UCLASS()
class KOCKAM_API APickupActor : public AActor
{
	GENERATED_BODY()

public:
	APickupActor();

	virtual void Tick(float DeltaSeconds) override;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Kockam")
	int32 CoinValue = 1;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Kockam")
	float RespawnDelay = 1.5f;

	/** Degrees per second. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Kockam")
	float SpinSpeed = 120.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Kockam")
	float PickupRadius = 120.f;

protected:
	virtual void BeginPlay() override;

	UFUNCTION()
	void HandleOverlap(
		UPrimitiveComponent* OverlappedComponent,
		AActor* OtherActor,
		UPrimitiveComponent* OtherComp,
		int32 OtherBodyIndex,
		bool bFromSweep,
		const FHitResult& SweepResult);

	void Respawn();

	UPROPERTY(VisibleAnywhere, Category = "Kockam")
	TObjectPtr<USphereComponent> Trigger;

	UPROPERTY(VisibleAnywhere, Category = "Kockam")
	TObjectPtr<UStaticMeshComponent> Mesh;

private:
	FTimerHandle RespawnTimer;

	/** False between being taken and respawning. */
	bool bAvailable = true;
};
