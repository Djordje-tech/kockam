#include "PickupActor.h"

#include "Components/SphereComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "GameFramework/Pawn.h"
#include "KockamPlayerState.h"
#include "TimerManager.h"
#include "UObject/ConstructorHelpers.h"

APickupActor::APickupActor()
{
	PrimaryActorTick.bCanEverTick = true;

	Trigger = CreateDefaultSubobject<USphereComponent>(TEXT("Trigger"));
	Trigger->InitSphereRadius(PickupRadius);
	Trigger->SetCollisionProfileName(TEXT("OverlapAllDynamic"));
	RootComponent = Trigger;

	Mesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
	Mesh->SetupAttachment(Trigger);
	Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

	// A cylinder tipped on its side and squashed flat reads as a coin standing
	// on its edge. Engine primitives only, so this needs no imported art.
	Mesh->SetRelativeRotation(FRotator(90.f, 0.f, 0.f));
	Mesh->SetRelativeScale3D(FVector(0.6f, 0.6f, 0.08f));

	static ConstructorHelpers::FObjectFinder<UStaticMesh> CylinderMesh(
		TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
	if (CylinderMesh.Succeeded())
	{
		Mesh->SetStaticMesh(CylinderMesh.Object);
	}
}

void APickupActor::BeginPlay()
{
	Super::BeginPlay();

	Trigger->SetSphereRadius(PickupRadius);
	Trigger->OnComponentBeginOverlap.AddDynamic(this, &APickupActor::HandleOverlap);
}

void APickupActor::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	if (bAvailable)
	{
		// World rotation, so the coin spins upright regardless of how the mesh
		// was tipped to face the camera.
		Mesh->AddWorldRotation(FRotator(0.f, SpinSpeed * DeltaSeconds, 0.f));
	}
}

void APickupActor::HandleOverlap(
	UPrimitiveComponent* /*OverlappedComponent*/,
	AActor* OtherActor,
	UPrimitiveComponent* /*OtherComp*/,
	int32 /*OtherBodyIndex*/,
	bool /*bFromSweep*/,
	const FHitResult& /*SweepResult*/)
{
	if (!bAvailable || !HasAuthority())
	{
		return;
	}

	const APawn* Pawn = Cast<APawn>(OtherActor);
	if (!Pawn)
	{
		return;
	}

	AKockamPlayerState* State = Pawn->GetPlayerState<AKockamPlayerState>();
	if (!State)
	{
		return;
	}

	State->AddCoins(CoinValue);

	bAvailable = false;
	SetActorHiddenInGame(true);
	Trigger->SetGenerateOverlapEvents(false);

	GetWorldTimerManager().SetTimer(
		RespawnTimer, this, &APickupActor::Respawn, RespawnDelay, /* bLoop */ false);
}

void APickupActor::Respawn()
{
	bAvailable = true;
	SetActorHiddenInGame(false);
	Trigger->SetGenerateOverlapEvents(true);
}
