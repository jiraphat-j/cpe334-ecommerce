CREATE TABLE "order_status_events" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "from_status" "OrderStatus" NOT NULL,
    "to_status" "OrderStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "order_status_events_order_id_created_at_id_idx" ON "order_status_events"("order_id", "created_at", "id");

ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
