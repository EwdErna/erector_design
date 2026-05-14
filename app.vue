<template>
  <div class="app-container">
    <nav>
      <Navigation></Navigation>
    </nav>
    <main>
      <section class="left">
        <SelectComponents></SelectComponents>
      </section>
      <section class="center">
        <div class="scene-area">
          <ThreeDScene></ThreeDScene>
        </div>
        <div class="error-area">
          <InvalidConnections></InvalidConnections>
        </div>
      </section>
      <section class="right">
        <EditComponent></EditComponent>
      </section>
    </main>
    <footer></footer>
    <div class="mobile-only">
      <FloatingFileButtons />
      <BottomSheet />
    </div>
  </div>
</template>

<style scoped>
@media (min-width: 769px),
(pointer: fine) {
  .app-container {
    height: calc(100vh - 16px);

    nav {
      height: 64px;
    }

    footer {
      height: 20px;
    }

    main {
      width: 100%;
      height: calc(100% - 84px);
      display: flex;

      .left {
        width: 25%;
        background-color: #f0f0f0;
      }

      .right {
        width: 25%;
        background-color: #f0f0f0;
      }

      .center {
        width: 50%;
        display: flex;
        flex-direction: column;

        .scene-area {
          flex: 0 0 80%;
          overflow: hidden;
        }

        .error-area {
          flex: 0 0 20%;
          overflow: hidden;
        }
      }
    }
  }

  .mobile-only {
    display: none;
  }
}

@media (max-width: 768px) and (pointer: coarse) {
  .app-container {
    height: 100vh;

    nav {
      display: none;
    }

    footer {
      display: none;
    }

    main {
      position: fixed;
      inset: 0;

      .left,
      .right {
        display: none;
      }

      .center {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;

        .scene-area {
          flex: 1;
          overflow: hidden;
        }

        .error-area {
          display: none;
        }
      }
    }
  }
}
</style>
