-- Serialize provider setup across replicas without holding a transaction over HTTP.
ALTER TABLE "av_channel_connection"
  ADD COLUMN "connectLeaseOwner" TEXT,
  ADD COLUMN "connectLeaseUntil" TIMESTAMP(3),
  ADD CONSTRAINT "av_channel_connection_connect_lease_pair"
    CHECK (("connectLeaseOwner" IS NULL) = ("connectLeaseUntil" IS NULL));
