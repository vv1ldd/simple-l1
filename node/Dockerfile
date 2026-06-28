FROM rust:1-alpine AS realm-interpreter-builder

RUN apk add --no-cache musl-dev

WORKDIR /build

COPY implementations/rust/realm-interpreter-v1/Cargo.toml ./Cargo.toml
COPY implementations/rust/realm-interpreter-v1/src ./src
RUN cargo build --release

FROM node:20-alpine

# Install PHP for the MDK Kernel
RUN apk add --no-cache php83 php83-json php83-openssl php83-mbstring php83-tokenizer build-base python3 && \
    ln -sf /usr/bin/php83 /usr/bin/php

WORKDIR /app
COPY --from=realm-interpreter-builder /build/target/release/realm-interpreter /usr/local/bin/realm-interpreter

COPY node/package*.json ./
RUN npm install --verbose

# Copy kernel source (now local to node folder)
COPY node/kernel ./kernel
COPY node/www ./www
COPY node/. .

# We assume MDK Kernel is copied into the /app/kernel directory during build
# For local dev, we will mount it via docker-compose

EXPOSE 3000

CMD ["npm", "start"]
