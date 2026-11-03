-- O claim é persistido antes da rede; uma tentativa interrompida só pode ser conciliada.
ALTER TABLE "AvMessageOutbox" DROP CONSTRAINT "av_outbox_state";
ALTER TABLE "AvMessageOutbox"
  ADD CONSTRAINT "av_outbox_state" CHECK ("state" IN ('PENDING', 'SENDING', 'UNCERTAIN', 'ACCEPTED', 'DELIVERED', 'READ', 'FAILED', 'DISCARDED', 'BLOCKED'));
CREATE INDEX "AvMessageOutbox_state_leaseUntil_idx" ON "AvMessageOutbox" ("state", "leaseUntil");
