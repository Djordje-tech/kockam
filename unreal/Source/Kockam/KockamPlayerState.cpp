#include "KockamPlayerState.h"

#include "Engine/Engine.h"
#include "Net/UnrealNetwork.h"

AKockamPlayerState::AKockamPlayerState()
{
	bReplicates = true;
}

void AKockamPlayerState::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
	Super::GetLifetimeReplicatedProps(OutLifetimeProps);

	DOREPLIFETIME(AKockamPlayerState, Coins);
}

void AKockamPlayerState::AddCoins(int32 Amount)
{
	// The server is the only authority on currency. A client that somehow
	// reaches this call changes nothing that anyone else can see.
	if (!HasAuthority())
	{
		return;
	}

	Coins += Amount;

	// Replication does not call OnRep on the server, so drive the display
	// directly here for listen-server and standalone play.
	ShowBalance();
}

void AKockamPlayerState::OnRep_Coins()
{
	ShowBalance();
}

void AKockamPlayerState::ShowBalance() const
{
	if (GEngine)
	{
		// A stable key so the message updates in place instead of stacking up.
		GEngine->AddOnScreenDebugMessage(
			/* Key */ 1,
			/* TimeToDisplay */ 5.f,
			FColor::Yellow,
			FString::Printf(TEXT("Coins: %d"), Coins));
	}
}
