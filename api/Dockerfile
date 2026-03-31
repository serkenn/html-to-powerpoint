FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl fonts-ipafont-gothic fonts-noto-cjk \
  && mkdir -p /usr/local/share/fonts/montserrat \
  && mkdir -p /usr/local/share/fonts/notojp \
  && curl -fsSL https://fonts.gstatic.com/s/montserrat/v31/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCtr6Ew-.ttf \
    -o /usr/local/share/fonts/montserrat/Montserrat-Regular.ttf \
  && curl -fsSL https://fonts.gstatic.com/s/montserrat/v31/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCtZ6Ew-.ttf \
    -o /usr/local/share/fonts/montserrat/Montserrat-Medium.ttf \
  && curl -fsSL https://fonts.gstatic.com/s/montserrat/v31/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCu170w-.ttf \
    -o /usr/local/share/fonts/montserrat/Montserrat-SemiBold.ttf \
  && curl -fsSL https://fonts.gstatic.com/s/montserrat/v31/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCuM70w-.ttf \
    -o /usr/local/share/fonts/montserrat/Montserrat-Bold.ttf \
  && curl -fsSL https://fonts.gstatic.com/s/montserrat/v31/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCvC70w-.ttf \
    -o /usr/local/share/fonts/montserrat/Montserrat-Black.ttf \
  && curl -fsSL https://fonts.gstatic.com/s/notosansjp/v56/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFBEj75s.ttf \
    -o /usr/local/share/fonts/notojp/NotoSansJP-Regular.ttf \
  && curl -fsSL https://fonts.gstatic.com/s/notosansjp/v56/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFCMj75s.ttf \
    -o /usr/local/share/fonts/notojp/NotoSansJP-Medium.ttf \
  && curl -fsSL https://fonts.gstatic.com/s/notosansjp/v56/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFPYk75s.ttf \
    -o /usr/local/share/fonts/notojp/NotoSansJP-Bold.ttf \
  && curl -fsSL https://fonts.gstatic.com/s/notosansjp/v56/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFLgk75s.ttf \
    -o /usr/local/share/fonts/notojp/NotoSansJP-Black.ttf \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install

COPY src ./src

ENV NODE_ENV=production
ENV PORT=8788

EXPOSE 8788

CMD ["npm", "start"]
