// Show Desktop scoops every app window aside, but the hardware notch the
// panel poses as does not move. AppKit's stationary collection behavior is
// what exempts a window from Exposé, and Electron only sets it on
// `desktop`-type windows, which can never take keyboard focus — so this
// Node-API addon sets the flag on the panel's own NSWindow. It has to run in
// the app's process: no external helper can reach another process's windows.
//
// The Node-API surface is declared inline rather than by importing
// node_api.h: these few declarations are the frozen version-1 C ABI, and
// vendoring Node's headers to reach them would be the larger liability.

#import <AppKit/AppKit.h>
#include <stddef.h>

typedef struct napi_env__ *napi_env;
typedef struct napi_value__ *napi_value;
typedef struct napi_callback_info__ *napi_callback_info;
typedef int napi_status;
typedef napi_value (*napi_callback)(napi_env env, napi_callback_info info);

extern napi_status napi_get_cb_info(napi_env env, napi_callback_info info, size_t *argc,
                                    napi_value *argv, napi_value *thisArg, void **data);
extern napi_status napi_get_buffer_info(napi_env env, napi_value value, void **data,
                                        size_t *length);
extern napi_status napi_create_function(napi_env env, const char *name, size_t length,
                                        napi_callback callback, void *data, napi_value *result);
extern napi_status napi_set_named_property(napi_env env, napi_value object, const char *name,
                                           napi_value value);
extern napi_status napi_get_undefined(napi_env env, napi_value *result);
extern napi_status napi_create_double(napi_env env, double value, napi_value *result);
extern napi_status napi_throw_error(napi_env env, const char *code, const char *message);

// Returns the window's resulting collection-behavior mask, so a caller can
// confirm the stationary bit is set on the real NSWindow rather than trust
// that the call landed.
static napi_value MakeStationary(napi_env env, napi_callback_info info) {
  napi_value undefined = NULL;
  napi_get_undefined(env, &undefined);

  size_t argc = 1;
  napi_value argv[1] = {NULL};
  void *handle = NULL;
  size_t handleLength = 0;
  // The argument is the Buffer from BrowserWindow.getNativeWindowHandle(),
  // whose bytes are the NSView pointer itself.
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != 0 || argc < 1 ||
      napi_get_buffer_info(env, argv[0], &handle, &handleLength) != 0 ||
      handleLength != sizeof(NSView *)) {
    napi_throw_error(env, NULL, "makeStationary expects a native window handle");
    return undefined;
  }

  NSView *view = *(NSView *__unsafe_unretained *)handle;
  NSWindow *window = view.window;
  if (window == nil) {
    napi_throw_error(env, NULL, "The native window handle has no window behind it");
    return undefined;
  }
  window.collectionBehavior |= NSWindowCollectionBehaviorStationary;

  napi_value behavior = NULL;
  if (napi_create_double(env, (double)window.collectionBehavior, &behavior) != 0) {
    return undefined;
  }
  return behavior;
}

__attribute__((visibility("default"))) napi_value napi_register_module_v1(napi_env env,
                                                                          napi_value exports) {
  napi_value makeStationary = NULL;
  if (napi_create_function(env, "makeStationary", (size_t)-1, MakeStationary, NULL,
                           &makeStationary) == 0) {
    napi_set_named_property(env, exports, "makeStationary", makeStationary);
  }
  return exports;
}
