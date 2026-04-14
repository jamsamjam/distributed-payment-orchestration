FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY pom.xml .
RUN mvn dependency:go-offline -q
COPY src/ ./src/
RUN mvn package -DskipTests -q

FROM eclipse-temurin:21-jre-alpine
RUN apk add --no-cache wget
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar

EXPOSE 8081

HEALTHCHECK --interval=10s --timeout=5s --retries=15 \
  CMD wget -qO- http://localhost:8081/actuator/health || exit 1

ENTRYPOINT ["java", "-XX:+UseContainerSupport", "-XX:MaxRAMPercentage=75.0", "-jar", "app.jar"]
